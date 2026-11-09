import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildBrief, HAIR_IDS, LIMITS, noteRejection, type Adjustments } from "@/lib/edit-brief";

const schema = z.object({
  imageDataUrl: z.string().min(32).max(7_000_000),
  bust: z.number().int().min(LIMITS.bust.min).max(LIMITS.bust.max),
  waist: z.number().int().min(LIMITS.waist.min).max(LIMITS.waist.max),
  hips: z.number().int().min(LIMITS.hips.min).max(LIMITS.hips.max),
  shoulders: z.number().int().min(LIMITS.shoulders.min).max(LIMITS.shoulders.max),
  thighs: z.number().int().min(LIMITS.thighs.min).max(LIMITS.thighs.max),
  hair: z.enum(HAIR_IDS),
  customHair: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  note: z.string().max(400),
  attested: z.literal(true),
});

const DATA_URL = /^data:image\/jpeg;base64,[a-zA-Z0-9+/=]+$/;

const hits: number[] = [];

function takeSlot(): boolean {
  const now = Date.now();
  while (hits.length && now - hits[0]! > 60 * 60 * 1000) hits.shift();
  const lastMinute = hits.filter((stamp) => now - stamp < 60_000).length;
  if (lastMinute >= 6 || hits.length >= 24) return false;
  hits.push(now);
  return true;
}

function friendlyApiError(status: number, raw: string): string {
  const lowered = raw.toLowerCase();
  if (
    status === 400 ||
    status === 403 ||
    lowered.includes("content") ||
    lowered.includes("safety") ||
    lowered.includes("policy") ||
    lowered.includes("moderation")
  ) {
    return "That edit was blocked. Keep it a clothed change on an adult photo, and try a smaller adjustment.";
  }
  if (status === 429) return "The image service is busy. Wait a moment and render again.";
  if (status === 402 || lowered.includes("spending-limit") || lowered.includes("run out of credits")) {
    return "Image credits are used up. Add credits to your Grok account, then render again — your dials will still be set.";
  }
  return "The render didn't finish. Try again in a moment.";
}

export const editPhoto = createServerFn({ method: "POST" })
  .validator((input: unknown) => {
    const parsed = schema.safeParse(input);
    if (!parsed.success) throw new Error("That edit request isn't valid.");
    return parsed.data;
  })
  .handler(async ({ data }) => {
    if (!DATA_URL.test(data.imageDataUrl)) {
      return { ok: false as const, error: "Use a JPEG photo under a few megabytes." };
    }
    const rejected = noteRejection(data.note);
    if (rejected) return { ok: false as const, error: rejected };
    if (!data.attested) {
      return { ok: false as const, error: "Confirm the photo is of an adult you have permission to edit." };
    }
    if (!takeSlot()) {
      return {
        ok: false as const,
        error: "Too many renders in a short time. Wait a minute and try again.",
      };
    }

    const apiKey = process.env.XAI_API_KEY;
    if (!apiKey) return { ok: false as const, error: "Image rendering isn't available in this preview." };

    const adjustments: Adjustments = {
      bust: data.bust,
      waist: data.waist,
      hips: data.hips,
      shoulders: data.shoulders,
      thighs: data.thighs,
      note: data.note,
      hair: data.hair,
      customHair: data.customHair,
    };
    const brief = buildBrief(adjustments);

    let response: Response;
    try {
      response = await fetch("https://api.x.ai/v1/images/edits", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "grok-imagine-image-2.0",
          prompt: brief,
          image: { url: data.imageDataUrl, type: "image_url" },
        }),
        signal: AbortSignal.timeout(90_000),
      });
    } catch {
      return { ok: false as const, error: "The render timed out. Try again." };
    }

    if (!response.ok) {
      const raw = await response.text();
      return { ok: false as const, error: friendlyApiError(response.status, raw) };
    }

    const body = (await response.json()) as {
      data?: { url?: string; b64_json?: string }[];
    };
    const item = body.data?.[0];
    if (item?.b64_json) {
      return {
        ok: true as const,
        image: `data:image/png;base64,${item.b64_json}`,
        brief,
      };
    }
    if (!item?.url) {
      return { ok: false as const, error: "The render came back empty. Try again." };
    }

    try {
      const imageResponse = await fetch(item.url, { signal: AbortSignal.timeout(30_000) });
      if (!imageResponse.ok) {
        return { ok: false as const, error: "The render finished, but the image couldn't be saved." };
      }
      const mime = imageResponse.headers.get("content-type")?.split(";")[0] || "image/png";
      const bytes = new Uint8Array(await imageResponse.arrayBuffer());
      const image = `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
      return { ok: true as const, image, brief };
    } catch {
      return { ok: false as const, error: "The render finished, but the image couldn't be saved." };
    }
  });
