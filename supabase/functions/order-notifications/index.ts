import { customerEmail, ownerEmail, type MailOrder } from "./email-templates.ts";

const allowedOrigin = Deno.env.get("SITE_ORIGIN") || "https://maniksahni.github.io";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...cors, "Content-Type": "application/json" },
});

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
};
const utf8Base64 = (value: string) => bytesToBase64(new TextEncoder().encode(value));
const mimeBase64 = (value: string) => utf8Base64(value).replace(/.{1,76}/g, "$&\r\n").trimEnd();
const base64Url = (value: string) => utf8Base64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
const safeHeader = (value: string) => value.replace(/[\r\n]/g, " ").trim();

async function accessToken() {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_REFRESH_TOKEN");
  if (!clientId || !clientSecret || !refreshToken) throw new Error("Google Gmail OAuth is not configured");

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    console.error("Google OAuth token refresh failed", { status: response.status, error: result.error });
    throw new Error("Google Gmail authorization failed");
  }
  return String(result.access_token);
}

async function sendMail(token: string, from: string, to: string, replyTo: string, subject: string, html: string, text: string) {
  const boundary = `kc_${crypto.randomUUID().replaceAll("-", "")}`;
  const message = [
    `From: Kay Charly <${safeHeader(from)}>`,
    `To: ${safeHeader(to)}`,
    `Reply-To: ${safeHeader(replyTo)}`,
    `Subject: =?UTF-8?B?${utf8Base64(safeHeader(subject))}?=`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    mimeBase64(text),
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    mimeBase64(html),
    `--${boundary}--`,
    "",
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(message) }),
  });
  if (!response.ok) {
    const details = await response.text();
    console.error("Gmail API send failed", { status: response.status, details: details.slice(0, 500) });
    return false;
  }
  return true;
}

Deno.serve(async request => {
  if (request.headers.get("origin") && request.headers.get("origin") !== allowedOrigin) return json({ error: "Origin not allowed" }, 403);
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const owner = (Deno.env.get("OWNER_EMAIL") || "kaycharly91750@gmail.com").trim();
  const from = (Deno.env.get("GOOGLE_SENDER_EMAIL") || "kaycharly37@gmail.com").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!owner || !from || !supabaseUrl || !serviceKey) return json({ error: "Order email service is not configured" }, 503);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from)) return json({ error: "Email configuration is invalid" }, 503);

  let reference = "";
  try {
    const body = await request.json();
    reference = String(body?.reference ?? "").trim();
  } catch {
    return json({ error: "Invalid request" }, 400);
  }
  if (!/^KC-[A-F0-9]{10}$/.test(reference)) return json({ error: "Invalid order reference" }, 400);

  const query = new URLSearchParams({ select: "reference,customer_name,customer_email,phone,address,note,pickup,items,total,created_at", reference: `eq.${reference}`, limit: "1" });
  const lookup = await fetch(`${supabaseUrl}/rest/v1/kc_orders?${query}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!lookup.ok) return json({ error: "Could not load order" }, 502);
  const [order] = await lookup.json() as MailOrder[];
  if (!order || !order.customer_email) return json({ error: "Order or customer email not found" }, 404);

  try {
    const token = await accessToken();
    const customer = customerEmail(order);
    const ownerNotice = ownerEmail(order);
    const [customerSent, ownerSent] = await Promise.all([
      sendMail(token, from, order.customer_email, owner, customer.subject, customer.html, customer.text),
      sendMail(token, from, owner, order.customer_email, ownerNotice.subject, ownerNotice.html, ownerNotice.text),
    ]);
    if (!customerSent || !ownerSent) {
      console.error("Order email delivery incomplete", { reference, customer_sent: customerSent, owner_sent: ownerSent });
      return json({ customer_sent: customerSent, owner_sent: ownerSent, error: "One or more emails could not be sent" }, 502);
    }
    return json({ customer_sent: true, owner_sent: true });
  } catch (error) {
    console.error("Order email service failed", { reference, error: String(error) });
    return json({ error: "Order email service is unavailable" }, 503);
  }
});
