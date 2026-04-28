import { LoaderFunctionArgs } from "@remix-run/node";

import { buildShippingCsv, getShippingOrders } from "../shipping-export.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedIds = new Set(url.searchParams.getAll("ids"));
  const orders = (await getShippingOrders(admin)).filter(
    (order) => selectedIds.size === 0 || selectedIds.has(order.id),
  );
  const csvContent = buildShippingCsv(orders);

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"shipping_labels.csv\"",
      "Cache-Control": "no-store",
    },
  });
};
