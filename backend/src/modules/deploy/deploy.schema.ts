import { z } from 'zod';

export const SwitchTemplateSchema = z.object({
  templateId: z.coerce.number().int().positive(),
});
export type SwitchTemplateInput = z.infer<typeof SwitchTemplateSchema>;
