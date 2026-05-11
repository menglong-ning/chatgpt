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
  EmptyState,
  TextField,
} from "@shopify/polaris";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const orders = await getShippingOrders(admin);
  return { orders };
};

function normalizeDigits(value: string) {
  return value.replace(/[０-９]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) - 0xfee0),
  );
}

function normalizeOrderName(value: string) {
  const trimmed = normalizeDigits(value).trim();
  if (!trimmed) return "";

  const withoutHash = trimmed.replace(/^#+/, "");
  return withoutHash ? `#${withoutHash}` : "";
}

function parseOrderNames(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\s,，、;；]+/)
        .map(normalizeOrderName)
        .filter(Boolean),
    ),
  );
}

export default function Index() {
  const { orders } = useLoaderData<typeof loader>();
  const location = useLocation();
  const [isExporting, setIsExporting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [orderInput, setOrderInput] = useState("");
  const [matchedIds, setMatchedIds] = useState<string[]>([]);
  const [missingOrderNames, setMissingOrderNames] = useState<string[]>([]);
  const [hasMatched, setHasMatched] = useState(false);

  const selectedIdSet = new Set(selectedIds);
  const allSelected = orders.length > 0 && selectedIds.length === orders.length;
  const exportCount = selectedIds.length || orders.length;
  const canUseMatchedOrders = hasMatched && matchedIds.length > 0;

  const ordersByName = new Map(
    orders.map((order: any) => [normalizeOrderName(order.name), order]),
  );

  const toggleOrder = (id: string, checked: boolean) => {
    setSelectedIds((current) => {
      if (checked) return Array.from(new Set([...current, id]));
      return current.filter((selectedId) => selectedId !== id);
    });
  };

  const toggleAll = (checked: boolean) => {
    setSelectedIds(checked ? orders.map((order: any) => order.id) : []);
  };

  const matchOrders = () => {
    const requestedNames = parseOrderNames(orderInput);
    const foundIds: string[] = [];
    const missingNames: string[] = [];
    const seenIds = new Set<string>();

    for (const name of requestedNames) {
      const order = ordersByName.get(name);
      if (!order) {
        missingNames.push(name);
        continue;
      }

      if (!seenIds.has(order.id)) {
        foundIds.push(order.id);
        seenIds.add(order.id);
      }
    }

    setMatchedIds(foundIds);
    setMissingOrderNames(missingNames);
    setHasMatched(true);
  };

  const selectMatchedOrders = () => {
    setSelectedIds(matchedIds);
  };

  const exportOrders = async (ids: string[]) => {
    setIsExporting(true);

    try {
      const params = new URLSearchParams(location.search);
      ids.forEach((id) => params.append("ids", id));
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

  const handleExport = async () => {
    await exportOrders(selectedIds);
  };

  const handleExportMatched = async () => {
    await exportOrders(matchedIds);
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

              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">
                  订单号匹配
                </Text>
                <TextField
                  label="订单号"
                  labelHidden
                  value={orderInput}
                  onChange={setOrderInput}
                  placeholder="1057, 1092, #1122"
                  autoComplete="off"
                  multiline={3}
                />
                <InlineStack gap="300" wrap>
                  <Button onClick={matchOrders}>匹配订单</Button>
                  <Button onClick={selectMatchedOrders} disabled={!canUseMatchedOrders}>
                    全选找到的订单
                  </Button>
                  <Button
                    onClick={handleExportMatched}
                    disabled={!canUseMatchedOrders}
                    loading={isExporting}
                  >
                    导出匹配到的订单
                  </Button>
                </InlineStack>
                {hasMatched && (
                  <BlockStack gap="100">
                    <Text as="p" variant="bodyMd">
                      找到 {matchedIds.length} 个，没找到 {missingOrderNames.length} 个
                    </Text>
                    {missingOrderNames.length > 0 && (
                      <Text as="p" variant="bodyMd">
                        没找到：{missingOrderNames.join(", ")}
                      </Text>
                    )}
                  </BlockStack>
                )}
              </BlockStack>

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
