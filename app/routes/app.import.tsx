import { authenticate } from "../shopify.server";
import { ActionFunctionArgs } from "@remix-run/node";
import { useActionData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  Button,
  BlockStack,
  Text,
  DropZone,
  Banner,
  List,
  LegacyStack,
  Thumbnail,
} from "@shopify/polaris";
import { useState, useCallback } from "react";
import Papa from "papaparse";
import { NoteIcon } from "@shopify/polaris-icons";

type ImportMode = "create" | "update";

function normalizeTrackingNumber(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  if (/^\d+(?:\.\d+)?e\+\d+$/i.test(raw)) {
    const [coefficient, exponent] = raw.toLowerCase().split("e+");
    const digitsAfterDecimal = coefficient.split(".")[1]?.length || 0;
    const digits = coefficient.replace(".", "");
    const zeroCount = Number(exponent) - digitsAfterDecimal;

    return zeroCount >= 0 ? `${digits}${"0".repeat(zeroCount)}` : digits;
  }

  return raw.replace(/\D/g, "");
}

function getImportMode(value: FormDataEntryValue | null): ImportMode {
  return value === "update" ? "update" : "create";
}

function selectFulfillmentToUpdate(fulfillments: any[]) {
  const activeFulfillments = fulfillments.filter(
    (fulfillment) =>
      fulfillment.status !== "CANCELLED" && fulfillment.status !== "CANCELED",
  );

  return (
    activeFulfillments[activeFulfillments.length - 1] ||
    fulfillments[fulfillments.length - 1]
  );
}

async function updateTrackingInfo(
  admin: any,
  orderName: string,
  trackingNumber: string,
  company: string,
) {
  const orderQuery = await admin.graphql(
    `query getExistingFulfillment($query: String!) {
      orders(first: 1, query: $query) {
        edges {
          node {
            fulfillments(first: 10) {
              id
              status
              trackingInfo {
                company
                number
                url
              }
            }
          }
        }
      }
    }`,
    { variables: { query: `name:${orderName}` } },
  );
  const orderData = await orderQuery.json();
  if (orderData.errors?.length) {
    throw new Error(orderData.errors[0].message);
  }

  const orderNode = orderData.data?.orders?.edges?.[0]?.node;
  if (!orderNode) {
    return { status: "Failed", error: "Order not found" };
  }

  const fulfillments = orderNode.fulfillments || [];
  const fulfillment = selectFulfillmentToUpdate(fulfillments);
  if (!fulfillment) {
    return {
      status: "Failed",
      error: "Existing fulfillment not found. Use Start Fulfillment first.",
    };
  }

  const updateMutation = await admin.graphql(
    `mutation FulfillmentTrackingInfoUpdate($fulfillmentId: ID!, $trackingInfoInput: FulfillmentTrackingInput!, $notifyCustomer: Boolean) {
      fulfillmentTrackingInfoUpdate(fulfillmentId: $fulfillmentId, trackingInfoInput: $trackingInfoInput, notifyCustomer: $notifyCustomer) {
        fulfillment {
          id
          status
          trackingInfo {
            company
            number
            url
          }
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      variables: {
        fulfillmentId: fulfillment.id,
        notifyCustomer: true,
        trackingInfoInput: {
          number: trackingNumber || "",
          company: company || "",
        },
      },
    },
  );

  const updateData = await updateMutation.json();
  if (updateData.errors?.length) {
    throw new Error(updateData.errors[0].message);
  }

  const errors = updateData.data?.fulfillmentTrackingInfoUpdate?.userErrors;
  if (errors && errors.length > 0) {
    return { status: "Failed", error: errors[0].message };
  }

  return { status: "Updated" };
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const rowsStr = formData.get("rows") as string;
  const mode = getImportMode(formData.get("mode"));
  if (!rowsStr) return { success: false, message: "No data provided" };

  const rows = JSON.parse(rowsStr);
  const results: any[] = [];

  for (const row of rows) {
    const { orderName, trackingNumber, company } = row;
    try {
      if (mode === "update") {
        const result = await updateTrackingInfo(
          admin,
          orderName,
          trackingNumber,
          company,
        );
        results.push({ order: orderName, ...result });
        continue;
      }

      // 1. Find Fulfillment Order ID
      const orderQuery = await admin.graphql(
        `query getFulfillmentOrder($query: String!) {
          orders(first: 1, query: $query) {
            edges {
              node {
                fulfillmentOrders(first: 10) {
                  edges {
                    node {
                      id
                      status
                      requestStatus
                      supportedActions {
                        action
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { variables: { query: `name:${orderName}` } }
      );
      const orderData = await orderQuery.json();
      const orderNode = orderData.data?.orders?.edges?.[0]?.node;
      if (!orderNode) {
        results.push({
          order: orderName,
          status: "Failed",
          error: "Order not found",
        });
        continue;
      }

      const fulfillmentOrders =
        orderNode.fulfillmentOrders?.edges?.map(
          (edge: any) => edge.node,
        ) || [];
      const fulfillableOrder =
        fulfillmentOrders.find((fo: any) =>
          fo.supportedActions?.some((item: any) => item.action === "CREATE_FULFILLMENT"),
        ) || fulfillmentOrders.find((fo: any) => fo.status === "OPEN");

      if (!fulfillableOrder) {
        const statuses = fulfillmentOrders
          .map((fo: any) => `${fo.status}/${fo.requestStatus}`)
          .join(", ");
        results.push({
          order: orderName,
          status: "Failed",
          error: statuses
            ? `Fulfillment order not fulfillable (${statuses})`
            : "Fulfillment order not found. Reauthorize the app with merchant-managed fulfillment order permissions.",
        });
        continue;
      }

      // 2. Fulfill
      const fulfillMut = await admin.graphql(
        `mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
          fulfillmentCreate(fulfillment: $fulfillment) {
            fulfillment {
              id
              status
            }
            userErrors {
              field
              message
            }
          }
        }`,
        {
          variables: {
            fulfillment: {
              lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: fulfillableOrder.id }],
              notifyCustomer: true,
              trackingInfo: {
                number: trackingNumber || "",
                company: company || ""
              }
            }
          }
        }
      );
      
      const fulfillData = await fulfillMut.json();
      const errors = fulfillData.data?.fulfillmentCreate?.userErrors;
      
      if (errors && errors.length > 0) {
        results.push({ order: orderName, status: "Failed", error: errors[0].message });
      } else {
        results.push({ order: orderName, status: "Success" });
      }

    } catch (e: any) {
      results.push({ order: orderName, status: "Error", error: e.message });
    }
  }

  return { success: true, mode, results };
};

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [parsedData, setParsedData] = useState<any[]>([]);
  const submit = useSubmit();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  
  const isSubmitting = navigation.state === "submitting";
  const submittingMode = navigation.formData?.get("mode");

  const handleDropZoneDrop = useCallback(
    (_dropFiles: File[], acceptedFiles: File[], _rejectedFiles: File[]) => {
      const selectedFile = acceptedFiles[0];
      setFile(selectedFile);
      
      Papa.parse(selectedFile, {
        header: false, // e-Hiden / Yamato format usually doesn't use headers
        skipEmptyLines: true,
        complete: (results) => {
          // Expected headers for Yamato B2 / Sagawa e-Hiden (No Headers format):
          // Column 0 (A): Order Name (e.g. #1040)
          // Column 3 (D): Tracking Number (e.g. 389692304702)
          
          const mapped = results.data.map((row: any) => {
            // Check if parsing as array (no header) or object (header)
            let orderName, trackingNumber;
            if (Array.isArray(row)) {
              // Format: [A, B, C, D, E, F...]
              orderName = row[0]?.trim();     // A 列
              trackingNumber = normalizeTrackingNumber(row[3]); // D 列
            } else {
              // Fallback for header format
              orderName = row["Order Name"]?.trim() || row["A"]?.trim();
              trackingNumber = normalizeTrackingNumber(row["Tracking Number"] || row["D"]);
            }

            const normalizedOrderName =
              orderName && /^\d+$/.test(orderName) ? `#${orderName}` : orderName;

            return {
              orderName: normalizedOrderName,
              trackingNumber: trackingNumber,
              company: "Yamato", // Default for Japan shipping files
            };
          }).filter((r: any) => r.orderName && r.orderName.startsWith("#") && r.trackingNumber);
          
          setParsedData(mapped);
        }
      });
    },
    [],
  );

  const handleSubmit = (mode: ImportMode) => {
    if (parsedData.length === 0) return;
    const formData = new FormData();
    formData.append("rows", JSON.stringify(parsedData));
    formData.append("mode", mode);
    submit(formData, { method: "POST" });
  };

  const fileUpload = !file && <DropZone.FileUpload />;
  const uploadedFile = file && (
    <LegacyStack>
      <Thumbnail size="small" alt={file.name} source={NoteIcon} />
              <div>
                {file.name} <Text variant="bodySm" as="p">{parsedData.length} records found</Text>
              </div>
    </LegacyStack>
  );

  return (
    <Page 
      title="Bulk Import Tracking" 
      backAction={{ content: "Back", url: "/app" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="p" variant="bodyMd">
                Upload your generated tracking CSV (e.g. B2 or e-Hiden). 
                The system expects <strong>Column A</strong> as the Order Name (e.g., #1040) and <strong>Column D</strong> as the Tracking Number.
              </Text>
              
              <DropZone onDrop={handleDropZoneDrop} allowMultiple={false} accept=".csv">
                {uploadedFile}
                {fileUpload}
              </DropZone>
              
              <Button 
                variant="primary" 
                onClick={() => handleSubmit("create")}
                disabled={parsedData.length === 0 || isSubmitting}
                loading={isSubmitting && submittingMode !== "update"}
              >
                Start Fulfillment ({parsedData.length} orders)
              </Button>

              <Button
                onClick={() => handleSubmit("update")}
                disabled={parsedData.length === 0 || isSubmitting}
                loading={isSubmitting && submittingMode === "update"}
              >
                Update Existing Tracking ({parsedData.length} orders)
              </Button>

              {parsedData.length > 0 && (
                <List>
                  {parsedData.map((row, index) => (
                    <List.Item key={`${row.orderName}-${index}`}>
                      <strong>{row.orderName}</strong>: {row.trackingNumber}
                    </List.Item>
                  ))}
                </List>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {actionData?.results && (
          <Layout.Section>
            <Card>
              <BlockStack gap="300">
                <Text as="h3" variant="headingMd">Results</Text>
                <List>
                  {actionData.results.map((res: any, idx: number) => (
                    <List.Item key={idx}>
                      <strong>{res.order}</strong>: {res.status} {res.error ? `(${res.error})` : ''}
                    </List.Item>
                  ))}
                </List>
              </BlockStack>
            </Card>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
