import { Rule } from '@mailops/schema';
import { z } from 'zod';

export const ImportBody = z
  .object({ rules: z.array(Rule).min(1).max(1000) })
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.rules.forEach((r, i) => {
      if (seen.has(r.label)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rules', i, 'label'],
          message: `Duplicate rule for label "${r.label}"`,
        });
      }
      seen.add(r.label);
    });
  });
export type ImportBody = z.infer<typeof ImportBody>;
