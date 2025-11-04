// index.mjs  (nodejs18/20)
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const TABLE_NAME       = process.env.TABLE_NAME ?? "trading_log";
const PARTITION_KEY    = process.env.PARTITION_KEY || "PK";
const SORT_KEY         = process.env.SORT_KEY || "SK";
const ALLOWED_ORIGINS  = process.env.ALLOWED_ORIGINS ?? "*";

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGINS,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,POST",
    "Content-Type": "application/json; charset=utf-8"
  };
}

export const handler = async (event = {}) => {
  const method = event.httpMethod || event?.requestContext?.http?.method || (event.body ? "POST" : "GET");

  if (method === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (method === "GET")     return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok:true, message:"POST a trade." }) };
  if (method !== "POST")    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error:"Method Not Allowed" }) };

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error:"Invalid JSON" }) }; }

  // Accept either PK/SK or acctId/sortKey
  const pkVal = body.PK ?? body[PARTITION_KEY] ?? body.acctId;
  const skVal = body.SK ?? body[SORT_KEY]      ?? body.sortKey;

  const required = ["symbol","direction","qty","entryPrice","status","openedAt"];
  const missing = [];
  if (!pkVal) missing.push(PARTITION_KEY);
  if (!skVal) missing.push(SORT_KEY);
  for (const k of required) if (body[k] === undefined || body[k] === null || body[k] === "") missing.push(k);
  if (missing.length) return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error:"Missing fields", missing }) };

  const item = {
    [PARTITION_KEY]: String(pkVal),
    [SORT_KEY]: String(skVal),
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
      ConditionExpression: "attribute_not_exists(#pk) AND attribute_not_exists(#sk)",
      ExpressionAttributeNames: { "#pk": PARTITION_KEY, "#sk": SORT_KEY }
    }));
    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify({ ok:true, tradeId: item.tradeId }) };
  } catch (err) {
    const status = err?.name === "ConditionalCheckFailedException" ? 409 : 500;
    return { statusCode: status, headers: corsHeaders(), body: JSON.stringify({ error: err?.name || "ServerError", message: err?.message }) };
  }
};
