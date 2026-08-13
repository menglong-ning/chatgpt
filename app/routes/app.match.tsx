import { ActionFunctionArgs } from "@remix-run/node";

import {
  getShippingOrdersByNames,
  normalizeShippingOrderName,
} from "../shipping-export.server";
import { authenticate } from "../shopify.server";

function jsonResponse(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");

  return new Response(JSON.stringify(data), {
    ...init,
    headers,
  });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const rawNames = formData.get("names");

  if (typeof rawNames !== "string") {
    return jsonResponse(
      { orders: [], missingOrderNames: [], error: "No order names provided" },
      { status: 400 },
    );
  }

  let names: string[];
  try {
    names = JSON.parse(rawNames);
  } catch {
    return jsonResponse(
      { orders: [], missingOrderNames: [], error: "Invalid order names" },
      { status: 400 },
    );
  }

  const requestedNames = Array.from(
    new Set(names.map(normalizeShippingOrderName).filter(Boolean)),
  );
  const orders = await getShippingOrdersByNames(admin, requestedNames);
  const foundNames = new Set(
    orders.map((order) => normalizeShippingOrderName(order.name)),
  );

  return jsonResponse({
    orders: orders.map((order) => ({
      id: order.id,
      name: order.name,
      displayFulfillmentStatus: order.displayFulfillmentStatus,
    })),
    missingOrderNames: requestedNames.filter((name) => !foundNames.has(name)),
  });
};
