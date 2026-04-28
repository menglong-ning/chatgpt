import { authenticate } from "../shopify.server";
import { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useLocation } from "@remix-run/react";
import { useState } from "react";
import { getShippingOrders } from "../shipping-export.server";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  Checkbox,
  Text,
  InlineStack,
  EmptyState
} from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getShippingOrders(admin);
  return { orders };
};

export default function Index() {
  const { orders } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [isExporting, setIsExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const selectedIdSet = new Set(selectedIds);
  const allSelected = orders.length > 0 && selectedIds.length === orders.length;
  const exportCount = selectedIds.length || orders.length;

  const toggleOrder = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, id]));
      return current.filter((selectedId) => selectedId !== id);
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? orders.map((order: any) => order.id) : []);
  };

  const handleExport = async () => {
    setIsExporting(true);

    try {
      const params = new URLSearchParams(location.search);
      selectedIds.forEach((id) => params.append("ids", id));
      const query = params.toString();
      const response = await fetch(`/app/export${query ? `?${query}` : ""}`);
      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "shipping_labels.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } finally {
      setIsExporting(false);
    }
  };
  return (
    <Page title="Fulfillment Manager">
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h2" variant="headingMd">
                  Orders for Export ({orders.length})
                </Text>
                <InlineStack gap="300">
                  <Button url={`/app/import${location.search}`}>
                    Import Tracking
                  </Button>
                  <Button variant="primary" onClick={handleExport} loading={isExporting}>
                    Export to CSV ({exportCount})
                  </Button>
                </InlineStack>
              </InlineStack>
              {orders.length === 0 ? (
                <EmptyState
                  heading="No unfulfilled orders found"
                  image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                >
                  <p>When you get new orders, they will show up here.</p>
                </EmptyState>
              ) : (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ borderCollapse: "collapse", width: "100%" }}>
                    <thead>
                      <tr>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left", width: "56px" }}>
                          <Checkbox
                            label=""
                            checked={allSelected}
                            onChange={toggleAll}
                          />
                        </th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Order</th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Date</th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Customer</th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Phone</th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Zip</th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Address</th>
                        <th style={{ borderBottom: "1px solid #dfe3e8", padding: "12px", textAlign: "left" }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order: any) => (
                        <tr key={order.id}>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>
                            <Checkbox
                              label=""
                              checked={selectedIdSet.has(order.id)}
                              onChange={(checked) => toggleOrder(order.id, checked)}
                            />
                          </td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>{order.name}</td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>{new Date(order.createdAt).toLocaleDateString()}</td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>{order.shippingName || "N/A"}</td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>{order.phone || "N/A"}</td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>{order.zip || "N/A"}</td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>
                            {[order.addressLine1, order.addressLine2].filter(Boolean).join("") || "N/A"}
                          </td>
                          <td style={{ borderBottom: "1px solid #ebebeb", padding: "12px" }}>{order.displayFulfillmentStatus}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
