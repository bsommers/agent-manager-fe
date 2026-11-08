# Contract JSON Schema

`contract.schema.json` is a single JSON Schema document (draft 2020-12) generated from the same FieldSpec tables
that the TypeScript validators run on (`CLIENT_TABLE`, `SERVER_TABLE`, `HTTP_TABLE` and `AGENT_SPEC`). It lets an
adapter written in another language check recorded fixtures against the contract without reading TypeScript.

## 1. Purpose and the sender-contract principle

The schema describes what a conforming **sender** emits. It is strict on enums, bounds and integer-ness, and it
never forbids unknown fields (the contract says receivers ignore them). Receiver tolerance, such as an enum value
being dropped instead of rejected, is recorded as an annotation and not modelled. The validators in `src/validate.ts`
and `src/http.ts` stay normative: if the two ever disagree, the validators win and the schema is a bug.

## 2. Location and regeneration

- File: `packages/protocol/contract.schema.json` (checked in, self-contained, local `$ref` only).
- Regenerate: `npx vite-node packages/protocol/scripts/generate-schema.ts` (takes no arguments, writes only that file).
- `npm run contract:check` exits 1 when the file is missing or differs from the schema generated from the live
  tables, and prints the regeneration command. The same comparison is a unit test, so `npm test` and CI catch drift.

Review the diff after regenerating and commit it together with the table change.

## 3. Definition names

All definitions live under `#/$defs`:

| Name | Meaning |
|------|---------|
| `Agent` | the agent record, shared by every message and HTTP body that carries one |
| `client.TYPE` | one client-to-server message, e.g. `client.agent:resize` |
| `server.TYPE` | one server-to-client message, e.g. `server.agent:meta` |
| `http.KIND` | one HTTP response body, e.g. `http.health` |
| `ClientMessage`, `ServerMessage` | `oneOf` unions of the `client.*` and `server.*` definitions |

Message definitions pin `type` with a `const`; `http.*` definitions have no `type` property.

To validate a recorded message from any language, point a standard draft 2020-12 validator at the file and at the
reference (for example `#/$defs/ClientMessage` or `#/$defs/server.agent:meta`):

- Python: load the file, build a validator for a schema of `{"$ref": "#/$defs/ServerMessage", "$defs": ...}` or resolve the ref, then validate the fixture.
- Go: compile the file with a JSON Schema library, select the definition by its ref, validate the decoded fixture.
- Rust: build a validator from the file with a JSON Schema crate, select the definition by its ref, validate the `serde_json` value.

No validator package or version is recommended here.

## 4. Keyword mapping

| FieldSpec kind or rule | JSON Schema |
|------------------------|-------------|
| `string` | `type: string`, `minLength`, `maxLength`; `maxBytes` kept as `x-maxBytes`; `noControl` adds a `pattern` excluding U+0000 to U+001F and U+007F to U+009F; `trim` kept as `x-trim` |
| `token` | `type: string`, `minLength: 1`, `maxLength`, `pattern` for lowercase letters, digits, hyphen and underscore |
| `integer` | `type: integer` with `minimum` and `maximum` |
| `number` | `type: number` |
| `boolean` | `type: boolean` |
| `enum` | `type: string` with `enum`; `dropUnknown` kept as `x-dropUnknown` |
| `literal` | `const` |
| `scalar` | `type: [string, number, boolean]`, `maxLength` (applies to strings) |
| `stringArray` | `type: array`, `minItems`, `maxItems`, `items` |
| `objectArray` | `type: array`, `maxItems`, `items` is the object schema (or a `$ref` to `Agent`) |
| `object` | `type: object` with `properties` and `required` |
| `enumList` | `type: array`, `maxItems`, `uniqueItems`, string `items` restricted to the list, plus `x-dropUnknown` |
| `map` | `type: object`, `maxProperties`, `additionalProperties` from the value spec, `propertyNames` with length bounds and a `not`/`enum` excluding `__proto__`, `constructor`, `prototype` |
| `json` | empty schema (or `type: object`) with `x-maxDepth` and `x-maxChars` |
| `byTag` | `type: object` on the property, plus one `allOf` entry on the parent: `if` the tag field equals a value, `then` the property matches that variant |
| rule `exactlyOne` | `allOf` entry with a `oneOf` of `required` clauses |
| rule `atLeastOne` | `allOf` entry with an `anyOf` of `required` clauses |
| rule `gte` | annotation entry in `x-rules` (`kind`, `field`, `other`) |

Optional fields are never in `required`. Keys of `properties`, `required` lists and `$defs` are sorted so the file is
deterministic.

## 5. What the schema cannot say

- UTF-8 byte lengths (`x-maxBytes`) and trimming (`x-trim`): a whitespace-only value passes `minLength`.
- JSON nesting depth and serialized size (`x-maxDepth`, `x-maxChars`), and reserved keys below the top level of a `json` value.
- The `gte` cross-field rule (`x-rules`), for example `toSeq >= fromSeq` in `agent:gap`.
- Length unit: JSON Schema counts code points, the validators count UTF-16 units. They are equal for text in the Basic Multilingual Plane.
- Unknown `agent:meta` scopes are permitted (any object data), so new scopes can ship without a schema change.
- Receiver tolerance (dropped enum values, filtered capability lists) is not modelled.

Every case where the schema accepts a fixture the validators reject is listed with a reason in
`SCHEMA_LOOSER_THAN_VALIDATORS` in `src/__tests__/jsonschema-conformance.test.ts`, and a test fails if an entry is
wrong or stale.

## 6. Integers

Every integer field is emitted as `type: integer` with both `minimum` and `maximum`, never as `number` and never
unbounded. All bounds are within the safe-integer range (at most 9007199254740991), so JavaScript, JSON and 64-bit
integers agree. The conformance test holds a literal `PINNED_INTEGERS` map from schema path to `[minimum, maximum]`
and compares it with every integer node collected from the generated document. Adding, removing or re-bounding an
integer field fails that test until the literal is edited on purpose.

## 7. Extending

Add a table of `MessageSpec` rows and register a group in `SCHEMA_GROUPS` in `src/jsonschema.ts`:

```ts
{ prefix: 'fleet', table: FLEET_TABLE, tagged: true, union: 'FleetMessage' }
```

`prefix` becomes the definition prefix (`fleet.ROW`), `tagged` adds a `type` const equal to the row key, and the
optional `union` names a `oneOf` over the group. This is how Phase 28 adds the bilterm fleet rows and the adapter
phases add cvm and climah rows. The new group is covered by the existing determinism and drift checks; regenerate
the file and commit it. `generateJsonSchema(groups)` accepts any group list, which is how the tests exercise this.

## 8. No validator dependency

The repository adds no JSON Schema package. The tests use an in-repo evaluator
(`src/__tests__/helpers/miniJsonSchema.ts`) that implements a small keyword set and throws on any other keyword, so
the generator cannot start emitting a keyword the tests do not check. Adapter test suites should use a standard
validator. Adding one to this repository as a devDependency must wait until plan 05-04 has merged (it owns the root
`package.json` and lockfile) and needs a Package Legitimacy Audit in that phase's RESEARCH.md.
