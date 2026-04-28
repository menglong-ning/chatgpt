const EXPORT_COLUMN_COUNT = 42;

type ShopifyAdmin = {
  graphql: (query: string, options?: any) => Promise<Response>;
};

export type ShippingOrder = {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  shippingName: string;
  shippingCountry: string;
  phone: string;
  zip: string;
  addressLine1: string;
  addressLine2: string;
};

type RawOrder = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt?: string | null;
  displayFulfillmentStatus?: string | null;
  phone?: string | null;
  customer?: {
    phone?: string | null;
    defaultAddress?: MailingAddress | null;
  } | null;
  shippingAddress?: MailingAddress | null;
  displayAddress?: MailingAddress | null;
  billingAddress?: MailingAddress | null;
};

type MailingAddress = {
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

const columnHeaders = Array.from({ length: EXPORT_COLUMN_COUNT }, (_, i) => {
  if (i < 26) return String.fromCharCode(65 + i);
  return `A${String.fromCharCode(65 + i - 26)}`;
});

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

function normalizeZip(value?: string | null) {
  return (value || "").replace(/\D/g, "").slice(0, 7);
}

function normalizeProvince(address: MailingAddress) {
  const code = (address.provinceCode || "").replace("-", "").toUpperCase();

  if (JAPAN_PREFECTURES_BY_CODE[code]) {
    return JAPAN_PREFECTURES_BY_CODE[code];
  }

  return address.province || "";
}

function splitAddress(value: string) {
  const chars = Array.from(value);
  return {
    addressLine1: chars.slice(0, 32).join(""),
    addressLine2: chars.slice(32).join(""),
  };
}

function getJapanShipDate() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}/${month}/${day}`;
}

function shouldExportOrder(order: RawOrder) {
  if (order.cancelledAt) return false;
  return true;
}

function addressScore(address?: MailingAddress | null) {
  if (!address) return 0;

  return [
    address.name,
    address.phone,
    address.zip,
    normalizeProvince(address),
    address.city,
    address.address1,
    address.address2,
  ].filter(Boolean).length;
}

function getBestAddress(order: RawOrder) {
  return [
    order.shippingAddress,
    order.displayAddress,
    order.billingAddress,
    order.customer?.defaultAddress,
  ].sort((a, b) => addressScore(b) - addressScore(a))[0] || {};
}

function toShippingOrder(order: RawOrder): ShippingOrder {
  const address = getBestAddress(order);
  const fullAddress = [
    normalizeProvince(address),
    address.city,
    address.address1,
    address.address2,
  ]
    .filter(Boolean)
    .join("");
  const split = splitAddress(fullAddress);

  return {
    id: order.id,
    name: order.name,
    createdAt: order.createdAt,
    displayFulfillmentStatus: order.displayFulfillmentStatus || "UNKNOWN",
    shippingName: address.name || "",
    shippingCountry: address.country || "",
    phone: normalizePhone(address.phone || order.phone || order.customer?.phone || order.customer?.defaultAddress?.phone),
    zip: normalizeZip(address.zip),
    addressLine1: split.addressLine1,
    addressLine2: split.addressLine2,
  };
}

export async function getShippingOrders(admin: ShopifyAdmin) {
  const response = await admin.graphql(
    `query GetOrdersForShippingExport {
      orders(first: 100, query: "status:any fulfillment_status:unshipped", reverse: true, sortKey: CREATED_AT) {
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            displayFulfillmentStatus
            phone
            customer {
              phone
              defaultAddress {
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
            }
            shippingAddress {
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
            displayAddress {
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
          }
        }
      }
    }`,
  );

  const { data } = await response.json();
  const orders = data?.orders?.edges?.map((edge: any) => edge.node) || [];

  return orders.filter(shouldExportOrder).map(toShippingOrder);
}

export function buildShippingCsv(orders: ShippingOrder[]) {
  const shipDate = getJapanShipDate();
  const rows = [columnHeaders];

  for (const order of orders) {
    const row = new Array(EXPORT_COLUMN_COUNT).fill("");

    row[0] = order.name; // A: 订单号
    row[1] = "0"; // B: 送り状種類
    row[4] = shipDate; // E: 出荷予定日
    row[8] = order.phone; // I: 电话号码
    row[10] = order.zip; // K: 邮编
    row[11] = order.addressLine1; // L: 地址，32文字以内
    row[12] = order.addressLine2; // M: 超出 L 的地址
    row[15] = order.shippingName; // P: 客户姓名
    row[17] = "様"; // R: 敬称
    row[19] = "06-4256-0501"; // T: ご依頼主電話番号
    row[21] = "5400037"; // V: ご依頼主郵便番号
    row[22] = "大阪府大阪市中央区内平野町１丁目４番１号"; // W: ご依頼主住所
    row[24] = "Ｖｉｓｔａ３Ｄ　Ｊａｐａｎ（株）"; // Y: ご依頼主名
    row[27] = "フィギュア"; // AB: 品名１
    row[39] = "09077660851"; // AN: 請求先顧客コード
    row[41] = "01"; // AP: 運賃管理番号

    rows.push(row);
  }

  return `\uFEFF${rows
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n")}\n`;
}
