import { z } from "zod";
export const FILE_LIMIT = 25 * 1024 * 1024;
export const STORAGE_LIMIT = 512 * 1024 * 1024;
export const TTL = 24 * 60 * 60 * 1000;
export const PAIR_TTL = 5 * 60 * 1000;
export const SESSION_TTL = 4 * 60 * 60 * 1000;
export const scopeSchema = z.enum(["owner", "session"]);
export const accessSchema = z.object({
  id: z.string(),
  token: z.string(),
  scope: scopeSchema,
  name: z.string(),
  expiresAt: z.number().nullable(),
});
export type Access = z.infer<typeof accessSchema>;
export const identitySchema = accessSchema.extend({
  server: z.string(),
  key: z.string(),
});
export type Identity = z.infer<typeof identitySchema>;
export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  scope: scopeSchema,
  createdAt: z.number(),
  expiresAt: z.number().nullable(),
  revoked: z.boolean(),
  encryptedKey: z.string().nullable(),
});
export type Device = z.infer<typeof deviceSchema>;
export const transferSchema = z.object({
  id: z.string(),
  scope: z.string(),
  author: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
  size: z.number(),
  metadata: z.string(),
});
export type Transfer = z.infer<typeof transferSchema>;
export const metadataSchema = z.object({
  name: z.string().max(1024),
  type: z.string().max(256),
  kind: z.enum(["text", "file"]),
});
export type Metadata = z.infer<typeof metadataSchema>;
export const pairStartSchema = z.object({
  name: z.string().trim().min(1).max(80),
  scope: scopeSchema,
  publicKey: z.string().max(200),
  code: z.string().regex(/^[A-F0-9]{12}$/),
});
export const pairSchema = pairStartSchema.extend({
  id: z.string(),
  expiresAt: z.number(),
});
export const pairResultSchema = z.object({
  access: accessSchema,
  publicKey: z.string(),
  wrappedKey: z.string(),
});
export const pairPollSchema = z.object({
  status: z.enum(["pending", "approved"]),
  result: pairResultSchema.optional(),
});
export const pairApprovalSchema = z.object({
  publicKey: z.string().max(200),
  wrappedKey: z.string().max(300),
  encryptedKey: z.string().max(300).nullable(),
});
export const setupSchema = z.object({
  secret: z.string().min(24).max(256),
  name: z.string().trim().min(1).max(80),
});
export const pairTicketSchema = z.object({
  id: z.string(),
  secret: z.string(),
  expiresAt: z.number(),
});
export type PairTicket = z.infer<typeof pairTicketSchema>;
