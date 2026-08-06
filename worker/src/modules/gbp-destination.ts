export interface NormalizedGbpDestination {
  id: string;
  businessName: string | null;
  phone: string | null;
  address: string | null;
  market: string | null;
  raw: Record<string, unknown>;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

export function normalizeGbpDestination(row: Record<string, unknown>): NormalizedGbpDestination {
  const address = objectValue(row.storefrontAddress ?? row.storefront_address ?? row.address);
  const phones = objectValue(row.phoneNumbers ?? row.phone_numbers);
  const addressLines = Array.isArray(address.addressLines ?? address.address_lines)
    ? (address.addressLines ?? address.address_lines) as unknown[]
    : [];
  const market = textValue(address.locality, address.city, row.locality, row.city);
  const addressText = [
    ...addressLines.map((line) => String(line ?? '').trim()).filter(Boolean),
    market,
    textValue(address.administrativeArea, address.administrative_area, address.state),
    textValue(address.postalCode, address.postal_code),
  ].filter(Boolean).join(', ');
  const id = textValue(row.location_id, row.id, row.name, row.resource_name) ?? '';
  const rawName = textValue(row.title, row.location_name, row.business_name, row.display_name);
  return {
    id,
    businessName: rawName,
    phone: textValue(phones.primaryPhone, phones.primary_phone, row.primary_phone, row.phone, row.phone_number),
    address: addressText || textValue(row.formatted_address, row.address_text),
    market,
    raw: row,
  };
}

function normalizedWords(value: string | null | undefined): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedPhone(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '').slice(-10);
}

export function destinationIdentityMatches(
  destination: NormalizedGbpDestination,
  expected: { businessName: string; phone: string | null; market: string | null },
): { ok: boolean; nameMatch: boolean; phoneMatch: boolean; marketMatch: boolean } {
  const actualName = normalizedWords(destination.businessName);
  const expectedName = normalizedWords(expected.businessName);
  const nameMatch = Boolean(actualName && expectedName && (
    actualName === expectedName || actualName.includes(expectedName) || expectedName.includes(actualName)
  ));
  const expectedPhone = normalizedPhone(expected.phone);
  const phoneMatch = Boolean(expectedPhone && normalizedPhone(destination.phone) === expectedPhone);
  const expectedMarket = normalizedWords(expected.market);
  const actualMarket = normalizedWords(destination.market ?? destination.address);
  const marketMatch = Boolean(expectedMarket && actualMarket.includes(expectedMarket));
  return { ok: nameMatch && phoneMatch && marketMatch, nameMatch, phoneMatch, marketMatch };
}
