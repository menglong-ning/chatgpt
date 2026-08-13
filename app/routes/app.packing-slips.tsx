import type { LoaderFunctionArgs } from "@remix-run/node";

import {
  buildPackingSlipsPdf,
  getPackingSlipOrders,
  getPackingSlipOrdersByIds,
} from "../packing-slip.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedIds = url.searchParams.getAll("ids");
  const orders =
    selectedIds.length > 0
      ? await getPackingSlipOrdersByIds(admin, selectedIds)
      : await getPackingSlipOrders(admin);
  const pdfContent = await buildPackingSlipsPdf(orders);

  return new Response(Buffer.from(pdfContent), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": "attachment; filename=\"packing_slips.pdf\"",
      "Cache-Control": "no-store",
    },
  });
};
