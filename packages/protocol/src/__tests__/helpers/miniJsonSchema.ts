/**
 * A deliberately small JSON Schema (draft 2020-12 subset) evaluator for the conformance tests.
 *
 * It implements exactly the keywords listed in IMPLEMENTED and throws on any other keyword, so the generator
 * cannot start emitting a keyword that the tests silently treat as always-true. Annotation keywords are
 * ignored: $schema, $id, $comment, $defs, title, description and every key starting with `x-`.
 */

type Json = unknown;
type Schema = Record<string, Json>;

const IGNORED = new Set(['$schema', '$id', '$comment', '$defs', 'title', 'description']);
export const IMPLEMENTED: ReadonlySet<string> = new Set([
  'type', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern', 'items', 'minItems',
  'maxItems', 'uniqueItems', 'properties', 'required', 'additionalProperties', 'maxProperties', 'propertyNames',
  'oneOf', 'anyOf', 'allOf', 'not', 'if', 'then', '$ref',
]);

const MAX_REF_DEPTH = 64;

const isObject = (v: Json): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);

function deepEqual(a: Json, b: Json): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function matchesType(type: string, v: Json): boolean {
  switch (type) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'boolean': return typeof v === 'boolean';
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return isObject(v);
    default: throw new Error(`miniJsonSchema: unknown type ${JSON.stringify(type)}`);
  }
}

function resolveRef(ref: string, root: Json): Json {
  if (!ref.startsWith('#')) throw new Error(`miniJsonSchema: only local refs are supported: ${ref}`);
  let node: Json = root;
  for (const raw of ref.slice(1).split('/').slice(1)) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObject(node) || !Object.hasOwn(node, key)) throw new Error(`miniJsonSchema: unresolvable ref ${ref}`);
    node = node[key];
  }
  return node;
}

function check(schema: Json, value: Json, root: Json, depth: number): boolean {
  if (typeof schema === 'boolean') return schema;
  if (!isObject(schema)) throw new Error('miniJsonSchema: a schema must be an object or boolean');
  if (depth > MAX_REF_DEPTH) throw new Error('miniJsonSchema: $ref nesting too deep (cycle?)');
  const s: Schema = schema;
  for (const key of Object.keys(s)) {
    if (IGNORED.has(key) || key.startsWith('x-') || IMPLEMENTED.has(key)) continue;
    throw new Error(`miniJsonSchema: unsupported keyword ${JSON.stringify(key)}`);
  }
  const sub = (child: Json, v: Json): boolean => check(child, v, root, depth + 1);

  if (typeof s.$ref === 'string' && !sub(resolveRef(s.$ref, root), value)) return false;
  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? (s.type as string[]) : [s.type as string];
    if (!types.some((t) => matchesType(t, value))) return false;
  }
  if (Array.isArray(s.enum) && !s.enum.some((e) => deepEqual(e, value))) return false;
  if (Object.hasOwn(s, 'const') && !deepEqual(s.const, value)) return false;

  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) return false;
    if (typeof s.maximum === 'number' && value > s.maximum) return false;
  }
  if (typeof value === 'string') {
    const length = [...value].length; // code points, as JSON Schema counts them
    if (typeof s.minLength === 'number' && length < s.minLength) return false;
    if (typeof s.maxLength === 'number' && length > s.maxLength) return false;
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern, 'u').test(value)) return false;
  }
  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) return false;
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) return false;
    if (s.uniqueItems === true && value.some((x, i) => value.findIndex((y) => deepEqual(x, y)) !== i)) return false;
    if (s.items !== undefined && !value.every((x) => sub(s.items, x))) return false;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    const props = isObject(s.properties) ? s.properties : {};
    if (Array.isArray(s.required) && !s.required.every((k) => Object.hasOwn(value, k as string))) return false;
    if (typeof s.maxProperties === 'number' && keys.length > s.maxProperties) return false;
    for (const key of keys) {
      if (Object.hasOwn(props, key)) {
        if (!sub(props[key], value[key])) return false;
      } else if (s.additionalProperties !== undefined && !sub(s.additionalProperties, value[key])) {
        return false;
      }
      if (s.propertyNames !== undefined && !sub(s.propertyNames, key)) return false;
    }
  }

  if (Array.isArray(s.allOf) && !s.allOf.every((c) => sub(c, value))) return false;
  if (Array.isArray(s.anyOf) && !s.anyOf.some((c) => sub(c, value))) return false;
  if (Array.isArray(s.oneOf) && s.oneOf.filter((c) => sub(c, value)).length !== 1) return false;
  if (s.not !== undefined && sub(s.not, value)) return false;
  if (s.if !== undefined && s.then !== undefined && sub(s.if, value) && !sub(s.then, value)) return false;
  return true;
}

/** Walks every subschema position of a document and throws on the first keyword the evaluator does not implement. */
export function assertSupported(schema: Json, path = '#'): void {
  if (typeof schema === 'boolean') return;
  if (!isObject(schema)) throw new Error(`miniJsonSchema: ${path} is not a schema`);
  for (const key of Object.keys(schema)) {
    if (!IGNORED.has(key) && !key.startsWith('x-') && !IMPLEMENTED.has(key)) {
      throw new Error(`miniJsonSchema: unsupported keyword ${JSON.stringify(key)} at ${path}`);
    }
  }
  const one = (key: string): void => {
    if (schema[key] !== undefined) assertSupported(schema[key], `${path}/${key}`);
  };
  const many = (key: string): void => {
    const list = schema[key];
    if (Array.isArray(list)) list.forEach((c, i) => assertSupported(c, `${path}/${key}/${i}`));
  };
  const named = (key: string): void => {
    const map = schema[key];
    if (isObject(map)) for (const k of Object.keys(map)) assertSupported(map[k], `${path}/${key}/${k}`);
  };
  for (const key of ['items', 'additionalProperties', 'propertyNames', 'not', 'if', 'then']) one(key);
  for (const key of ['oneOf', 'anyOf', 'allOf']) many(key);
  for (const key of ['properties', '$defs']) named(key);
}

/** True when `value` satisfies `schema`; `root` is the document that local `$ref`s resolve against. */
export function validates(schema: Json, value: Json, root: Json = schema): boolean {
  return check(schema, value, root, 0);
}
