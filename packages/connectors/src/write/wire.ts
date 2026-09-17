import { z } from 'zod';

/**
 * The command API's response shape.
 *
 * The write path parses its responses exactly as strictly as the read path does
 * (packages/connectors/CLAUDE.md §1). A write whose result is not understood is
 * worse than a read whose result is not understood: the read can be repeated,
 * and the write has already happened.
 */

/** `"ok"`, or an object describing why the one command in the batch failed. */
export const wireCommandStatusSchema = z.union([
  z.literal('ok'),
  z.object({
    error_code: z.number().int(),
    /** Vendor prose, frequently quoting the task's own content. Never surfaced. */
    error: z.string().optional(),
    error_tag: z.string().optional(),
    http_code: z.number().int().optional(),
  }),
]);

export const wireCommandResponseSchema = z.object({
  sync_status: z.record(z.string(), wireCommandStatusSchema),
  /** Present only for a create: the temporary id prisme sent, and the real one. */
  temp_id_mapping: z.record(z.string(), z.string()).optional(),
  sync_token: z.string().optional(),
});

export type WireCommandStatus = z.infer<typeof wireCommandStatusSchema>;
export type WireCommandResponse = z.infer<typeof wireCommandResponseSchema>;
