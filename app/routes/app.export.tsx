import { LoaderFunctionArgs } from "@remix-run/node";

import {
  buildShippingCsv,
  getShippingOrders,
  getShippingOrdersByIds,
} from "../shipping-export.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedIds = url.searchParams.getAll("ids");
  const orders =
    selectedIds.length > 0
      ? await getShippingOrdersByIds(admin, selectedIds)
      : await getShippingOrders(admin);
  const csvContent = buildShippingCsv(orders);

  return new Response(csvContent, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"shipping_labels.csv\"",
      "Cache-Control": "no-store",
    },
  });
};
