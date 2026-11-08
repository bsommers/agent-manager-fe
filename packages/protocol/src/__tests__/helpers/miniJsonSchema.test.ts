// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { assertSupported, validates } from './miniJsonSchema.js';

/** Each keyword: one accepting and one rejecting case, written from the JSON Schema meaning. */
const accepts = (schema: unknown, value: unknown): void => expect(validates(schema, value)).toBe(true);
const rejects = (schema: unknown, value: unknown): void => expect(validates(schema, value)).toBe(false);

describe('miniJsonSchema keywords', () => {
  it('type (single, list, integer)', () => {
    accepts({ type: 'string' }, 'a');
    rejects({ type: 'string' }, 1);
    accepts({ type: ['string', 'number'] }, 2);
    rejects({ type: ['string', 'number'] }, true);
    accepts({ type: 'integer' }, 3);
    rejects({ type: 'integer' }, 3.5);
    accepts({ type: 'number' }, 3.5);
    rejects({ type: 'object' }, []);
    accepts({ type: 'array' }, []);
    accepts({ type: 'null' }, null);
    rejects({ type: 'boolean' }, 'true');
  });

  it('enum and const', () => {
    accepts({ enum: ['a', 1] }, 1);
    rejects({ enum: ['a', 1] }, 'b');
    accepts({ const: { a: [1] } }, { a: [1] });
    rejects({ const: true }, 1);
    rejects({ const: 'x' }, undefined);
  });

  it('minimum and maximum', () => {
    accepts({ minimum: 1, maximum: 3 }, 3);
    rejects({ minimum: 1, maximum: 3 }, 0);
    rejects({ minimum: 1, maximum: 3 }, 4);
    accepts({ maximum: 1 }, 'ignored for strings');
  });

  it('minLength, maxLength count code points', () => {
    accepts({ minLength: 1, maxLength: 2 }, '\u{1F600}\u{1F600}');
    rejects({ maxLength: 1 }, '\u{1F600}\u{1F600}');
    rejects({ minLength: 1 }, '');
  });

  it('pattern is unanchored and uses the u flag', () => {
    accepts({ pattern: 'b' }, 'abc');
    rejects({ pattern: '^b' }, 'abc');
    accepts({ pattern: '^\\u{1F600}$' }, '\u{1F600}');
  });

  it('items, minItems, maxItems', () => {
    accepts({ items: { type: 'integer' }, minItems: 1, maxItems: 2 }, [1, 2]);
    rejects({ items: { type: 'integer' } }, [1, 'x']);
    rejects({ minItems: 1 }, []);
    rejects({ maxItems: 1 }, [1, 2]);
  });

  it('uniqueItems', () => {
    accepts({ uniqueItems: true }, [1, 2, { a: 1 }]);
    rejects({ uniqueItems: true }, [{ a: 1 }, { a: 1 }]);
    accepts({ uniqueItems: false }, [1, 1]);
  });

  it('properties and required', () => {
    accepts({ properties: { a: { type: 'string' } }, required: ['a'] }, { a: 'x', extra: 1 });
    rejects({ properties: { a: { type: 'string' } } }, { a: 1 });
    rejects({ required: ['a'] }, {});
    accepts({ properties: { a: { type: 'string' } } }, {});
  });

  it('additionalProperties as a schema and maxProperties', () => {
    const s = { properties: { a: { type: 'string' } }, additionalProperties: { type: 'integer' } };
    accepts(s, { a: 'x', b: 1 });
    rejects(s, { a: 'x', b: 'y' });
    accepts({ maxProperties: 1 }, { a: 1 });
    rejects({ maxProperties: 1 }, { a: 1, b: 2 });
  });

  it('propertyNames with a not-enum', () => {
    const s = { propertyNames: { minLength: 1, not: { enum: ['__proto__'] } } };
    accepts(s, { ok: 1 });
    rejects(s, JSON.parse('{"__proto__": 1}'));
    rejects(s, { '': 1 });
  });

  it('oneOf, anyOf, allOf, not', () => {
    accepts({ oneOf: [{ type: 'string' }, { type: 'number' }] }, 1);
    rejects({ oneOf: [{ type: 'number' }, { minimum: 0 }] }, 1); // two matches
    rejects({ oneOf: [{ type: 'string' }] }, 1); // no match
    accepts({ anyOf: [{ type: 'string' }, { type: 'number' }] }, 1);
    rejects({ anyOf: [{ type: 'string' }] }, 1);
    accepts({ allOf: [{ type: 'number' }, { minimum: 0 }] }, 1);
    rejects({ allOf: [{ type: 'number' }, { minimum: 5 }] }, 1);
    accepts({ not: { type: 'string' } }, 1);
    rejects({ not: { type: 'string' } }, 'a');
  });

  it('if/then; if without then is ignored', () => {
    const s = { if: { properties: { k: { const: 1 } }, required: ['k'] }, then: { required: ['v'] } };
    accepts(s, { k: 1, v: 1 });
    rejects(s, { k: 1 });
    accepts(s, { k: 2 });
    accepts({ if: { type: 'string' } }, 5);
  });

  it('local $ref, including pointer escapes, and the cycle guard', () => {
    const root = { $defs: { 'a/b~c': { type: 'integer' }, node: { $ref: '#/$defs/node' } } };
    expect(validates({ $ref: '#/$defs/a~1b~0c' }, 1, root)).toBe(true);
    expect(validates({ $ref: '#/$defs/a~1b~0c' }, 'x', root)).toBe(false);
    expect(() => validates({ $ref: '#/$defs/node' }, 1, root)).toThrow(/too deep/);
    expect(() => validates({ $ref: '#/$defs/missing' }, 1, root)).toThrow(/unresolvable/);
    expect(() => validates({ $ref: 'http://example.test/x' }, 1, root)).toThrow(/local refs/);
  });

  it('ignores annotations and x- keywords', () => {
    accepts({ $schema: 'x', $id: 'y', $comment: 'c', title: 't', description: 'd', 'x-anything': 1, $defs: { a: {} } }, 1);
  });

  it('throws on an unknown keyword, wherever it is, and assertSupported finds it without evaluation', () => {
    expect(() => validates({ format: 'email' }, 'a')).toThrow(/unsupported keyword "format"/);
    expect(() => validates({ patternProperties: {} }, {})).toThrow(/unsupported keyword/);
    const doc = { properties: { a: { oneOf: [{ type: 'string' }, { contains: {} }] } } };
    expect(() => assertSupported(doc)).toThrow(/unsupported keyword "contains" at #\/properties\/a\/oneOf\/1/);
    expect(() => assertSupported({ properties: { a: { type: 'string' } }, 'x-ok': { unknown: 1 } })).not.toThrow();
  });
});
