import Ajv, { type ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { ok, err, type Result } from '../../lib/result';

export interface TemplateManifest {
  slug: string;
  name: string;
  version: string;
  category?: string;
  git_repo?: string;
  git_ref?: string;
  db_dump?: string;
  theme?: { slug: string; path: string };
  plugins_required?: string[];
  default_pages?: string[];
  custom_post_types?: { slug: string; label: string }[];
  fields?: Array<{
    key: string;
    label: string;
    type: 'string' | 'richtext' | 'url' | 'email' | 'color' | 'image' | 'number' | 'boolean';
    required?: boolean;
    default?: unknown;
  }>;
  preview_image?: string;
  min_php?: string;
  min_wp?: string;
  [k: string]: unknown;
}

const schema = {
  type: 'object',
  additionalProperties: true,
  required: ['slug', 'name', 'version'],
  properties: {
    slug: {
      type: 'string',
      pattern: '^[a-z][a-z0-9-]*$',
      minLength: 2,
      maxLength: 64,
    },
    name: { type: 'string', minLength: 1, maxLength: 120 },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+(?:-[0-9a-zA-Z.-]+)?$',
    },
    category: { type: 'string', maxLength: 64 },
    git_repo: { type: 'string', maxLength: 512 },
    git_ref: { type: 'string', maxLength: 128 },
    db_dump: { type: 'string', maxLength: 256 },
    theme: {
      type: 'object',
      required: ['slug', 'path'],
      properties: {
        slug: { type: 'string', minLength: 1 },
        path: { type: 'string', minLength: 1 },
      },
    },
    plugins_required: { type: 'array', items: { type: 'string' } },
    default_pages: { type: 'array', items: { type: 'string' } },
    custom_post_types: {
      type: 'array',
      items: {
        type: 'object',
        required: ['slug', 'label'],
        properties: {
          slug: { type: 'string' },
          label: { type: 'string' },
        },
      },
    },
    fields: {
      type: 'array',
      items: {
        type: 'object',
        required: ['key', 'label', 'type'],
        additionalProperties: true,
        properties: {
          key: { type: 'string', pattern: '^[a-z][a-z0-9_]*$' },
          label: { type: 'string', minLength: 1 },
          type: {
            enum: ['string', 'richtext', 'url', 'email', 'color', 'image', 'number', 'boolean'],
          },
          required: { type: 'boolean' },
        },
      },
    },
    preview_image: { type: 'string' },
    min_php: { type: 'string' },
    min_wp: { type: 'string' },
  },
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateFn = ajv.compile<TemplateManifest>(schema);

const formatErrors = (errs: ErrorObject[] | null | undefined): string[] =>
  (errs ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);

export function validateManifest(data: unknown): Result<TemplateManifest, string[]> {
  if (validateFn(data)) return ok(data);
  return err(formatErrors(validateFn.errors));
}
