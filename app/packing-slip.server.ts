import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  type RGB,
} from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ORDERS_PAGE_SIZE = 250;
const ORDER_ID_QUERY_CHUNK_SIZE = 100;
const SHIPPING_ORDER_QUERY = "status:any fulfillment_status:unfulfilled";
const FONT_PATH = join(process.cwd(), "app/fonts/NotoSansCJKjp-Regular.otf");

const PAGE_WIDTH = 595.92;
const PAGE_HEIGHT = 842.88;
const PAGE_MARGIN = 60;
const CONTENT_WIDTH = PAGE_WIDTH - PAGE_MARGIN * 2;

const TEXT_COLOR = rgb(0.13, 0.13, 0.13);
const MUTED_TEXT_COLOR = rgb(0.38, 0.38, 0.38);
const LINE_COLOR = rgb(0.82, 0.82, 0.82);
const TABLE_HEADER_COLOR = rgb(0.94, 0.94, 0.94);

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
  customAttributes?: Array<{
    key?: string | null;
    value?: string | null;
  }> | null;
  image?: {
    url?: string | null;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type RawPackingSlipOrder = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  email?: string | null;
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
  imageUrl: string;
};

export type PackingSlipOrder = {
  id: string;
  name: string;
  createdAt: string;
  email: string;
  recipientName: string;
  customerName: string;
  phone: string;
  deliveryAddressLines: string[];
  lineItems: PackingSlipLineItem[];
};

type EmbeddedImageCache = Map<string, PDFImage | null>;

function normalizeAddressPart(value?: string | null) {
  return (value || "").trim();
}

function normalizeZip(value?: string | null) {
  return (value || "").replace(/\D/g, "").slice(0, 7);
}

function formatPostalCode(value?: string | null) {
  const normalized = normalizeZip(value);

  if (normalized.length === 7) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
  }

  return normalizeAddressPart(value);
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

function formatRecipientName(address: MailingAddress) {
  const surname = (address.lastName || "").trim();
  const givenName = (address.firstName || "").trim();
  const surnameFirstName = [surname, givenName].filter(Boolean).join("");

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

function formatCountry(value?: string | null) {
  const country = normalizeAddressPart(value);

  if (/^(japan|jp)$/i.test(country)) return "日本";

  return country;
}

function formatCityProvinceZip(address: MailingAddress) {
  const city = normalizeAddressPart(address.city);
  const province = normalizeAddressPart(address.provinceCode || address.province);
  const zip = formatPostalCode(address.zip);
  const provinceZip = [province, zip].filter(Boolean).join(" ");

  return [city, provinceZip].filter(Boolean).join(", ");
}

function getDeliveryAddressLines(address: MailingAddress, phone: string) {
  return [
    normalizeAddressPart(address.address1),
    normalizeAddressPart(address.address2),
    formatCityProvinceZip(address),
    formatCountry(address.country),
    phone,
  ].filter(Boolean);
}

function extractUrl(value?: string | null) {
  const match = normalizeAddressPart(value).match(/https?:\/\/[^\s"'<>]+/);
  return match?.[0] || "";
}

function getCustomAttributeImageUrl(item: RawPackingSlipLineItem) {
  const attributes = item.customAttributes || [];
  const imageLikeKeys = /image|preview|photo|picture|upload|file|画像|写真|プレビュー/i;

  for (const attribute of attributes) {
    if (!imageLikeKeys.test(attribute.key || "")) continue;

    const url = extractUrl(attribute.value);
    if (url) return url;
  }

  for (const attribute of attributes) {
    const url = extractUrl(attribute.value);
    if (url) return url;
  }

  return "";
}

function getLineItemImageUrl(item: RawPackingSlipLineItem) {
  return item.image?.url || getCustomAttributeImageUrl(item);
}

function toPackingSlipOrder(order: RawPackingSlipOrder): PackingSlipOrder {
  const address = getLabelAddress(order);
  const recipientName = formatRecipientName(address);
  const phone = normalizePhone(address.phone || order.phone);

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    email: order.email || "",
    recipientName,
    customerName: address.name || recipientName,
    phone,
    deliveryAddressLines: getDeliveryAddressLines(address, phone),
    lineItems:
      order.lineItems?.edges
        ?.map((edge) => edge.node)
        .filter((item): item is RawPackingSlipLineItem => Boolean(item))
        .map((item) => ({
          title: item.title || "",
          sku: item.sku || "",
          quantity: item.quantity || 0,
          variantTitle: item.variantTitle || "",
          imageUrl: getLineItemImageUrl(item),
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
              email
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
                    customAttributes {
                      key
                      value
                    }
                    image {
                      url(transform: { maxWidth: 300, maxHeight: 300 })
                      altText
                      width
                      height
                    }
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
            email
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
                  customAttributes {
                    key
                    value
                  }
                  image {
                    url(transform: { maxWidth: 300, maxHeight: 300 })
                    altText
                    width
                    height
                  }
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
  return new Intl.DateTimeFormat("en-CA", {
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
    color: options?.color || TEXT_COLOR,
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

function drawRightAlignedText(
  page: PDFPage,
  text: string,
  rightX: number,
  y: number,
  font: PDFFont,
  size: number,
) {
  const cleanText = sanitizeText(text);
  const textWidth = font.widthOfTextAtSize(cleanText, size);

  drawText(page, cleanText, rightX - textWidth, y, font, size);
}

function drawCenteredText(
  page: PDFPage,
  text: string,
  x: number,
  width: number,
  y: number,
  font: PDFFont,
  size: number,
  color = TEXT_COLOR,
) {
  const cleanText = sanitizeText(text);
  const textWidth = font.widthOfTextAtSize(cleanText, size);

  drawText(page, cleanText, x + Math.max(0, (width - textWidth) / 2), y, font, size, {
    color,
  });
}

function drawHorizontalLine(page: PDFPage, y: number, x = PAGE_MARGIN, width = CONTENT_WIDTH) {
  page.drawLine({
    start: { x, y },
    end: { x: x + width, y },
    thickness: 0.5,
    color: LINE_COLOR,
  });
}

function drawSectionTitle(
  page: PDFPage,
  title: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
) {
  drawText(page, title, x, y, font, 12);
  drawHorizontalLine(page, y - 10, x, width);
}

function drawOrderHeader(
  page: PDFPage,
  order: PackingSlipOrder,
  font: PDFFont,
  latinBoldFont: PDFFont,
) {
  drawText(page, "digxipop Japan", PAGE_MARGIN, PAGE_HEIGHT - 68, latinBoldFont, 21);
  drawRightAlignedText(page, "納品書", PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - 66, font, 18);
  drawRightAlignedText(
    page,
    `注文番号: ${order.name}`,
    PAGE_WIDTH - PAGE_MARGIN,
    PAGE_HEIGHT - 95,
    font,
    10,
  );
  drawRightAlignedText(
    page,
    `注文日: ${formatDate(order.createdAt)}`,
    PAGE_WIDTH - PAGE_MARGIN,
    PAGE_HEIGHT - 113,
    font,
    10,
  );
}

function drawAddressAndOrderInfo(page: PDFPage, order: PackingSlipOrder, font: PDFFont) {
  const leftX = PAGE_MARGIN;
  const rightX = 316;
  const sectionY = PAGE_HEIGHT - 110;
  const columnWidth = 236;

  drawSectionTitle(page, "配送先", leftX, sectionY, columnWidth, font);
  drawSectionTitle(page, "注文情報", rightX, sectionY, columnWidth, font);

  let y = sectionY - 30;
  drawText(page, order.recipientName || "N/A", leftX, y, font, 10);
  y -= 16;

  for (const line of order.deliveryAddressLines) {
    y = drawWrappedText(page, line, leftX, y, columnWidth, font, 10, 15);
  }

  y = sectionY - 30;
  drawText(page, `注文番号: ${order.name}`, rightX, y, font, 10);
  y -= 16;
  drawText(page, `顧客名: ${order.customerName || "N/A"}`, rightX, y, font, 10);
  y -= 16;
  drawText(page, `メール: ${order.email || "N/A"}`, rightX, y, font, 10, {
    maxWidth: columnWidth,
  });
}

function drawProductTableHeader(page: PDFPage, y: number, font: PDFFont) {
  drawSectionTitle(page, "商品一覧", PAGE_MARGIN, y, CONTENT_WIDTH, font);

  const headerTop = y - 26;
  page.drawRectangle({
    x: PAGE_MARGIN,
    y: headerTop - 30,
    width: CONTENT_WIDTH,
    height: 30,
    color: TABLE_HEADER_COLOR,
  });
  drawText(page, "画像", PAGE_MARGIN + 8, headerTop - 20, font, 10);
  drawCenteredText(page, "数量", PAGE_WIDTH - 135, 82, headerTop - 20, font, 10);
  drawHorizontalLine(page, headerTop - 30);

  return headerTop - 46;
}

function drawImagePlaceholder(page: PDFPage, x: number, y: number, size: number, font: PDFFont) {
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor: LINE_COLOR,
    borderWidth: 0.8,
    color: rgb(0.98, 0.98, 0.98),
  });
  drawCenteredText(page, "画像なし", x, size, y + size / 2 - 5, font, 9, MUTED_TEXT_COLOR);
}

function drawImageInBox(page: PDFPage, image: PDFImage, x: number, y: number, size: number) {
  page.drawRectangle({
    x,
    y,
    width: size,
    height: size,
    borderColor: LINE_COLOR,
    borderWidth: 0.8,
  });

  const scale = Math.min((size - 2) / image.width, (size - 2) / image.height);
  const width = image.width * scale;
  const height = image.height * scale;

  page.drawImage(image, {
    x: x + (size - width) / 2,
    y: y + (size - height) / 2,
    width,
    height,
  });
}

function isPng(bytes: Uint8Array) {
  return (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  );
}

function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8;
}

async function fetchImageBytes(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "image/png,image/jpeg,image/jpg,*/*;q=0.8",
      },
    });

    if (!response.ok) return null;

    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getEmbeddedImage(
  pdfDoc: PDFDocument,
  imageUrl: string,
  imageCache: EmbeddedImageCache,
) {
  if (!imageUrl) return null;
  if (imageCache.has(imageUrl)) return imageCache.get(imageUrl) || null;

  const imageBytes = await fetchImageBytes(imageUrl);
  let image: PDFImage | null = null;

  try {
    if (imageBytes && isPng(imageBytes)) {
      image = await pdfDoc.embedPng(imageBytes);
    } else if (imageBytes && isJpeg(imageBytes)) {
      image = await pdfDoc.embedJpg(imageBytes);
    }
  } catch {
    image = null;
  }

  imageCache.set(imageUrl, image);
  return image;
}

function drawFooter(page: PDFPage, font: PDFFont) {
  const centerX = PAGE_WIDTH / 2;
  const address =
    "540-0037, 大阪府 大阪市中央区内平野町 １丁目 4番１号, マーキュリー607室, 日本";

  drawCenteredText(page, "ご利用ありがとうございました。", centerX - 160, 320, 116, font, 9, MUTED_TEXT_COLOR);
  drawCenteredText(page, "digxipop Japan", centerX - 160, 320, 99, font, 9, MUTED_TEXT_COLOR);
  drawCenteredText(page, address, PAGE_MARGIN, CONTENT_WIDTH, 82, font, 8, MUTED_TEXT_COLOR);
  drawCenteredText(page, "hi@digxipop.com", centerX - 160, 320, 65, font, 8, MUTED_TEXT_COLOR);
  drawCenteredText(page, "shop-jp.digxipop.com", centerX - 160, 320, 48, font, 8, MUTED_TEXT_COLOR);
}

async function drawLineItem(
  pdfDoc: PDFDocument,
  page: PDFPage,
  item: PackingSlipLineItem,
  y: number,
  font: PDFFont,
  imageCache: EmbeddedImageCache,
) {
  const rowHeight = 116;
  const imageSize = 94;
  const imageX = PAGE_MARGIN + 7;
  const imageY = y - imageSize;
  const image = await getEmbeddedImage(pdfDoc, item.imageUrl, imageCache);

  if (image) {
    drawImageInBox(page, image, imageX, imageY, imageSize);
  } else {
    drawImagePlaceholder(page, imageX, imageY, imageSize, font);
  }

  drawCenteredText(page, String(item.quantity || ""), PAGE_WIDTH - 135, 82, y - 27, font, 12);
  drawHorizontalLine(page, y - rowHeight + 6);

  return y - rowHeight;
}

async function drawOrder(
  pdfDoc: PDFDocument,
  order: PackingSlipOrder,
  font: PDFFont,
  latinBoldFont: PDFFont,
  imageCache: EmbeddedImageCache,
) {
  let page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawOrderHeader(page, order, font, latinBoldFont);
  drawAddressAndOrderInfo(page, order, font);
  let y = drawProductTableHeader(page, PAGE_HEIGHT - 260, font);
  const items =
    order.lineItems.length > 0
      ? order.lineItems
      : [{ title: "", sku: "", quantity: 0, variantTitle: "", imageUrl: "" }];

  for (const item of items) {
    if (y - 116 < 145) {
      drawFooter(page, font);
      page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawOrderHeader(page, order, font, latinBoldFont);
      drawText(page, "商品一覧 続き", PAGE_MARGIN, PAGE_HEIGHT - 140, font, 12);
      y = drawProductTableHeader(page, PAGE_HEIGHT - 172, font);
    }

    y = await drawLineItem(pdfDoc, page, item, y, font, imageCache);
  }

  drawFooter(page, font);
}

export async function buildPackingSlipsPdf(orders: PackingSlipOrder[]) {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.registerFontkit(fontkit);
  const fontBytes = await readFile(FONT_PATH);
  const font = await pdfDoc.embedFont(fontBytes, { subset: true });
  const latinBoldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const imageCache: EmbeddedImageCache = new Map();

  if (orders.length === 0) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawText(page, "No orders found.", PAGE_MARGIN, PAGE_HEIGHT - 80, font, 18);
    drawFooter(page, font);
    return pdfDoc.save();
  }

  for (const order of orders) {
    await drawOrder(pdfDoc, order, font, latinBoldFont, imageCache);
  }

  return pdfDoc.save();
}
