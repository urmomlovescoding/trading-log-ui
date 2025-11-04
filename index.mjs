/// index.mjs  (Runtime: nodejs18.x or nodejs20.x)

// AWS SDK v3 (ESM)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME = process.env.TABLE_NAME ?? "trading_log";
// Real DynamoDB key names (your table uses PK/SK)
const PARTITION_KEY = process.env.PARTITION_KEY || "PK";
const SORT_KEY = process.env.SORT_KEY || "SK";

// Set this to your site origin before going live, e.g. "https://yourdomain.com"
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ?? "https://urmomlovescoding.github.io";

// v3 client + DocumentClient for automatic marshalling
const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json; charset=utf-8"
  };
}

export const handler = async (event = {}) => {
  // Infer method across HTTP API v2 / REST / direct tests
  const method =
    event.httpMethod ||
    event?.requestContext?.http?.method ||
    (event.body ? "POST" : "GET");

  // CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (method !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Method Not Allowed" })
    };
  }

  // Parse JSON body
  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Invalid JSON" })
    };
  }

  // Accept either (PK/SK) or (acctId/sortKey) from the caller
  const pkVal = body.PK ?? body[PARTITION_KEY] ?? body.acctId;
  const skVal = body.SK ?? body[SORT_KEY] ?? body.sortKey;

  // Required non-key fields
  const required = ["symbol", "direction", "qty", "entryPrice", "status", "openedAt"];

  const missing = [];
  if (!pkVal) missing.push(PARTITION_KEY);
  if (!skVal) missing.push(SORT_KEY);
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") missing.push(k);
  }
  if (missing.length) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ error: "Missing fields", missing })
    };
  }

  // Coerce + sanitize; write actual key names used by your table
  const item = {
    [PARTITION_KEY]: String(pkVal),                // writes PK
    [SORT_KEY]: String(skVal),                     // writes SK
    tradeId: body.tradeId ? String(body.tradeId) : "",
    symbol: String(body.symbol).toUpperCase(),
    direction: body.direction === "SHORT" ? "SHORT" : "LONG",
    qty: Number(body.qty),
    entryPrice: Number(body.entryPrice),
    exitPrice: Number(body.exitPrice ?? 0),
    status: body.status === "CLOSED" ? "CLOSED" : "OPEN",
    strategy: body.strategy ?? null,
    openedAt: String(body.openedAt),
    closedAt: body.closedAt ?? null,
    notes: body.notes ?? null
  };

  try {
    await ddb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: item,
      // Prevent accidental overwrite of an existing item with same PK/SK
      ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: {
        "#pk": PARTITION_KEY,
        "#sk": SORT_KEY
      }
    }));

    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({ ok: true, tradeId: item.tradeId })
    };
  } catch (err) {
    const status = err?.name === "ConditionalCheckFailedException" ? 409 : 500;
    return {
      statusCode: status,
      headers: corsHeaders(),
      body: JSON.stringify({
        error: err?.name || "ServerError",
        message: err?.message
      })
    };
  }
};
