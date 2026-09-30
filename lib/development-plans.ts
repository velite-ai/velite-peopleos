import { z } from "zod";

export const developmentActionSchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(3).max(200),
  description: z.string().max(2000).nullable().optional(),
  type: z.enum(["course", "coaching", "project", "reading", "certification", "other"]),
  dueDate: z.iso.date().nullable().optional(),
  status: z.enum(["not_started", "in_progress", "completed", "cancelled"]).default("not_started"),
}).strict();
