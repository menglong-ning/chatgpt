import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ORDERS_PAGE_SIZE = 250;
const ORDER_ID_QUERY_CHUNK_SIZE = 100;
const SHIPPING_ORDER_QUERY = "status:any fulfillment_status:unfulfilled";
const FONT_PATH = join(process.cwd(), "app/fonts/NotoSansCJKjp-Regular.otf");

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

type ShopifyAdmin = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

type MailingAddress = {
  firstName?: string | null;
  lastName?: string | null;
  name?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  province?: string | null;
  provinceCode?: string | null;
  zip?: string | null;
  phone?: string | null;
  country?: string | null;
};

type RawPackingSlipLineItem = {
  title?: string | null;
  sku?: string | null;
  quantity?: number | null;
  variantTitle?: string | null;
};

type RawPackingSlipOrder = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  phone?: string | null;
  shippingAddress?: MailingAddress | null;
  billingAddress?: MailingAddress | null;
  lineItems?: {
    edges?: Array<{
      node?: RawPackingSlipLineItem | null;
    }> | null;
  } | null;
};

type PackingSlipLineItem = {
  title: string;
  sku: string;
  quantity: number;
  variantTitle: string;
};

export type PackingSlipOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  recipientName: string;
  phone: string;
  zip: string;
  addressLines: string[];
  lineItems: PackingSlipLineItem[];
};

const JAPAN_PREFECTURES_BY_CODE: Record<string, string> = {
  JP01: "北海道",
  JP02: "青森県",
  JP03: "岩手県",
  JP04: "宮城県",
  JP05: "秋田県",
  JP06: "山形県",
  JP07: "福島県",
  JP08: "茨城県",
  JP09: "栃木県",
  JP10: "群馬県",
  JP11: "埼玉県",
  JP12: "千葉県",
  JP13: "東京都",
  JP14: "神奈川県",
  JP15: "新潟県",
  JP16: "富山県",
  JP17: "石川県",
  JP18: "福井県",
  JP19: "山梨県",
  JP20: "長野県",
  JP21: "岐阜県",
  JP22: "静岡県",
  JP23: "愛知県",
  JP24: "三重県",
  JP25: "滋賀県",
  JP26: "京都府",
  JP27: "大阪府",
  JP28: "兵庫県",
  JP29: "奈良県",
  JP30: "和歌山県",
  JP31: "鳥取県",
  JP32: "島根県",
  JP33: "岡山県",
  JP34: "広島県",
  JP35: "山口県",
  JP36: "徳島県",
  JP37: "香川県",
  JP38: "愛媛県",
  JP39: "高知県",
  JP40: "福岡県",
  JP41: "佐賀県",
  JP42: "長崎県",
  JP43: "熊本県",
  JP44: "大分県",
  JP45: "宮崎県",
  JP46: "鹿児島県",
  JP47: "沖縄県",
};

function normalizeAddressPart(value?: string | null) {
  return (value || "").trim();
}

function normalizeZip(value?: string | null) {
  return (value || "").replace(/\D/g, "").slice(0, 7);
}

function normalizePhone(value?: string | null) {
  let digits = (value || "").replace(/\D/g, "");

  if (digits.startsWith("81") && digits.length >= 11) {
    digits = `0${digits.slice(2)}`;
  }

  if (digits.length === 11) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  if (digits.length === 10) {
    return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  }

  return digits;
}

function normalizeProvince(address: MailingAddress) {
  const code = (address.provinceCode || "").replace("-", "").toUpperCase();

  if (JAPAN_PREFECTURES_BY_CODE[code]) {
    return JAPAN_PREFECTURES_BY_CODE[code];
  }

  return address.province || "";
}

function formatRecipientName(address: MailingAddress) {
  const surname = (address.lastName || "").trim();
  const givenName = (address.firstName || "").trim();
  const surnameFirstName = [surname, givenName].filter(Boolean).join(" ");

  return surnameFirstName || address.name || "";
}

function hasAddressDetails(address?: MailingAddress | null) {
  if (!address) return false;

  return [
    address.zip,
    address.province,
    address.provinceCode,
    address.city,
    address.address1,
    address.address2,
  ].some((value) => normalizeAddressPart(value));
}

function getLabelAddress(order: RawPackingSlipOrder): MailingAddress {
  if (hasAddressDetails(order.shippingAddress)) {
    return order.shippingAddress || {};
  }

  return order.billingAddress || {};
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }

  return chunks;
}

function shouldIncludeOrder(order: RawPackingSlipOrder) {
  return !order.cancelledAt;
}

function getAddressLines(address: MailingAddress) {
  return [
    [normalizeProvince(address), address.city, address.address1]
      .map(normalizeAddressPart)
      .filter(Boolean)
      .join(""),
    normalizeAddressPart(address.address2),
  ].filter(Boolean);
}

function toPackingSlipOrder(order: RawPackingSlipOrder): PackingSlipOrder {
  const address = getLabelAddress(order);

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    displayFulfillmentStatus: order.displayFulfillmentStatus || "UNKNOWN",
    recipientName: formatRecipientName(address),
    phone: normalizePhone(address.phone || order.phone),
    zip: normalizeZip(address.zip),
    addressLines: getAddressLines(address),
    lineItems:
      order.lineItems?.edges
        ?.map((edge) => edge.node)
        .filter((item): item is RawPackingSlipLineItem => Boolean(item))
        .map((item) => ({
          title: item.title || "",
          sku: item.sku || "",
          quantity: item.quantity || 0,
          variantTitle: item.variantTitle || "",
        })) || [],
  };
}

async function parseGraphqlResponse(response: Response, errorPrefix: string) {
  const { data, errors } = await response.json();

  if (errors?.length) {
    throw new Error(
      `${errorPrefix}: ${errors.map((error: any) => error.message).join(", ")}`,
    );
  }

  return data;
}

async function getPackingSlipOrdersByQuery(admin: ShopifyAdmin, query: string) {
  const orders: RawPackingSlipOrder[] = [];
  let cursor: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const response = await admin.graphql(
      `query GetPackingSlipOrders($first: Int!, $after: String, $query: String!) {
        orders(first: $first, after: $after, query: $query, reverse: true, sortKey: CREATED_AT) {
          pageInfo {
            hasNextPage
            endCursor
          }
          edges {
            node {
              id
              name
              createdAt
              cancelledAt
              displayFulfillmentStatus
              phone
              shippingAddress {
                firstName
                lastName
                name
                address1
                address2
                city
                province
                provinceCode
                zip
                phone
                country
              }
              billingAddress {
                firstName
                lastName
                name
                address1
                address2
                city
                province
                provinceCode
                zip
                phone
                country
              }
              lineItems(first: 100) {
                edges {
                  node {
                    title
                    sku
                    quantity
                    variantTitle
                  }
                }
              }
            }
          }
        }
      }`,
      {
        variables: {
          first: ORDERS_PAGE_SIZE,
          after: cursor,
          query,
        },
      },
    );

    const data = await parseGraphqlResponse(
      response,
      "Failed to load packing slip orders",
    );
    const page = data?.orders;
    orders.push(...(page?.edges?.map((edge: any) => edge.node) || []));

    hasNextPage = Boolean(page?.pageInfo?.hasNextPage);
    cursor = page?.pageInfo?.endCursor || null;

    if (hasNextPage && !cursor) {
      throw new Error("Failed to load packing slip orders: missing cursor");
    }
  }

  return orders;
}

export async function getPackingSlipOrders(admin: ShopifyAdmin) {
  const orders = await getPackingSlipOrdersByQuery(admin, SHIPPING_ORDER_QUERY);

  return orders.filter(shouldIncludeOrder).map(toPackingSlipOrder);
}

export async function getPackingSlipOrdersByIds(
  admin: ShopifyAdmin,
  orderIds: string[],
) {
  const orders: RawPackingSlipOrder[] = [];

  for (const chunk of chunkValues(uniqueValues(orderIds), ORDER_ID_QUERY_CHUNK_SIZE)) {
    const response = await admin.graphql(
      `query GetPackingSlipOrdersByIds($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Order {
            id
            name
            createdAt
            cancelledAt
            displayFulfillmentStatus
            phone
            shippingAddress {
              firstName
              lastName
              name
              address1
              address2
              city
              province
              provinceCode
              zip
              phone
              country
            }
            billingAddress {
              firstName
              lastName
              name
              address1
              address2
              city
              province
              provinceCode
              zip
              phone
              country
            }
            lineItems(first: 100) {
              edges {
                node {
                  title
                  sku
                  quantity
                  variantTitle
                }
              }
            }
          }
        }
      }`,
      { variables: { ids: chunk } },
    );

    const data = await parseGraphqlResponse(
      response,
      "Failed to load selected packing slip orders",
    );
    orders.push(...(data?.nodes?.filter(Boolean) || []));
  }

  return orders.filter(shouldIncludeOrder).map(toPackingSlipOrder);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function sanitizeText(value: unknown) {
  return Array.from(String(value || ""))
    .map((char) => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || code === 0x7f ? " " : char;
    })
    .join("")
    .trim();
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number) {
  const normalized = sanitizeText(text);
  if (!normalized) return [""];

  const lines: string[] = [];
  let current = "";

  for (const char of Array.from(normalized)) {
    const next = `${current}${char}`;
    if (font.widthOfTextAtSize(next, size) <= maxWidth || !current) {
      current = next;
      continue;
    }

    lines.push(current);
    current = char;
  }

  if (current) lines.push(current);
  return lines;
}

function drawText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  options?: { color?: RGB; maxWidth?: number },
) {
  page.drawText(sanitizeText(text), {
    x,
    y,
    size,
    font,
    color: options?.color || rgb(0.1, 0.1, 0.1),
    maxWidth: options?.maxWidth,
  });
}

function drawWrappedText(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  font: PDFFont,
  size: number,
  lineHeight = size + 4,
) {
  const lines = wrapText(text, font, size, maxWidth);

  for (const line of lines) {
    drawText(page, line, x, y, font, size);
    y -= lineHeight;
  }

  return y;
}

function drawHorizontalLine(page: PDFPage, y: number) {
  page.drawLine({
    start: { x: MARGIN, y },
    end: { x: PAGE_WIDTH - MARGIN, y },
    thickness: 0.6,
    color: rgb(0.72, 0.72, 0.72),
  });
}

function drawOrderHeader(page: PDFPage, order: PackingSlipOrder, font: PDFFont) {
  drawText(page, "PACKING SLIP / 装箱单", MARGIN, PAGE_HEIGHT - 56, font, 22);
  drawText(page, order.name, PAGE_WIDTH - 160, PAGE_HEIGHT - 50, font, 18);
  drawText(page, `注文日: ${formatDate(order.createdAt)}`, PAGE_WIDTH - 160, PAGE_HEIGHT - 72, font, 10);
  drawText(page, `状態: ${order.displayFulfillmentStatus}`, PAGE_WIDTH - 160, PAGE_HEIGHT - 88, font, 10);
  drawHorizontalLine(page, PAGE_HEIGHT - 105);
}

function drawAddressBlock(page: PDFPage, order: PackingSlipOrder, font: PDFFont) {
  let y = PAGE_HEIGHT - 132;

  drawText(page, "お届け先", MARGIN, y, font, 12);
  y -= 24;
  drawText(page, `${order.recipientName || "N/A"} 様`, MARGIN, y, font, 15);
  y -= 22;

  if (order.zip) {
    drawText(page, `〒${order.zip}`, MARGIN, y, font, 11);
    y -= 16;
  }

  for (const line of order.addressLines) {
    y = drawWrappedText(page, line, MARGIN, y, 260, font, 11, 15);
  }

  if (order.phone) {
    drawText(page, `TEL: ${order.phone}`, MARGIN, y, font, 10);
  }

  const senderX = 350;
  y = PAGE_HEIGHT - 132;
  drawText(page, "発送元", senderX, y, font, 12);
  y -= 22;
  drawText(page, "Vista3D Japan", senderX, y, font, 11);
  y -= 16;
  drawText(page, "〒5400037", senderX, y, font, 10);
  y -= 15;
  y = drawWrappedText(
    page,
    "大阪府大阪市中央区内平野町１丁目４番１号",
    senderX,
    y,
    175,
    font,
    10,
    14,
  );
  drawText(page, "TEL: 06-4256-0501", senderX, y, font, 10);
}

function drawTableHeader(page: PDFPage, y: number, font: PDFFont) {
  page.drawRectangle({
    x: MARGIN,
    y: y - 20,
    width: CONTENT_WIDTH,
    height: 24,
    color: rgb(0.93, 0.94, 0.95),
  });
  drawText(page, "数量", MARGIN + 8, y - 12, font, 10);
  drawText(page, "SKU", MARGIN + 56, y - 12, font, 10);
  drawText(page, "商品名", MARGIN + 165, y - 12, font, 10);
  drawHorizontalLine(page, y - 23);

  return y - 42;
}

function drawFooter(page: PDFPage, font: PDFFont, pageNumber: number) {
  drawHorizontalLine(page, 44);
  drawText(page, "Thank you for your order.", MARGIN, 25, font, 9);
  drawText(page, `Page ${pageNumber}`, PAGE_WIDTH - 90, 25, font, 9);
}

export async function buildPackingSlipsPdf(orders: PackingSlipOrder[]) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await readFile(FONT_PATH);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  let pageNumber = 0;

  if (orders.length === 0) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    drawText(page, "No orders found.", MARGIN, PAGE_HEIGHT - 80, font, 18);
    drawFooter(page, font, pageNumber);
    return pdfDoc.save();
  }

  for (const order of orders) {
    let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    pageNumber += 1;
    drawOrderHeader(page, order, font);
    drawAddressBlock(page, order, font);
    let y = drawTableHeader(page, PAGE_HEIGHT - 300, font);

    const items =
      order.lineItems.length > 0
        ? order.lineItems
        : [{ title: "商品情報なし", sku: "", quantity: 0, variantTitle: "" }];

    for (const item of items) {
      const title = [item.title, item.variantTitle].filter(Boolean).join(" / ");
      const titleLines = wrapText(title || "N/A", font, 10, 325);
      const rowHeight = Math.max(30, titleLines.length * 14 + 12);

      if (y - rowHeight < 58) {
        drawFooter(page, font, pageNumber);
        page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        pageNumber += 1;
        drawOrderHeader(page, order, font);
        drawText(page, "続き", MARGIN, PAGE_HEIGHT - 130, font, 12);
        y = drawTableHeader(page, PAGE_HEIGHT - 165, font);
      }

      drawText(page, String(item.quantity), MARGIN + 8, y, font, 10);
      drawWrappedText(page, item.sku || "-", MARGIN + 56, y, 95, font, 9, 13);
      drawWrappedText(page, title || "N/A", MARGIN + 165, y, 325, font, 10, 14);
      drawHorizontalLine(page, y - rowHeight + 8);
      y -= rowHeight;
    }

    drawFooter(page, font, pageNumber);
  }

  return pdfDoc.save();
}
