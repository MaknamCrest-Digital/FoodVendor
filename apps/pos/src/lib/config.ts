// No deployment-specific host is baked into the application. Configure an
// absolute HTTPS API for Android/static hosting, or proxy this same-origin path.
export const API_BASE_URL=(process.env.NEXT_PUBLIC_API_URL||'/api/v1').replace(/\/$/,'');
export const demoAccountsEnabled=process.env.NEXT_PUBLIC_DEMO_ACCOUNTS_ENABLED==='true';

// Preserve the supplied demo identity; deployments can select their provisioned
// terminal. These public identifiers are never an authorization credential.
export const terminal={
  businessId:process.env.NEXT_PUBLIC_BUSINESS_ID||'11111111-1111-1111-1111-111111111111',
  locationId:process.env.NEXT_PUBLIC_LOCATION_ID||'22222222-2222-2222-2222-222222222222',
  terminalId:process.env.NEXT_PUBLIC_TERMINAL_ID||'33333333-3333-3333-3333-333333333333',
  businessName:process.env.NEXT_PUBLIC_BUSINESS_NAME||'Adonai Pork',
  locationName:process.env.NEXT_PUBLIC_LOCATION_NAME||'Dansoman',
  terminalName:process.env.NEXT_PUBLIC_TERMINAL_NAME||'AD-01',
  brandMark:process.env.NEXT_PUBLIC_BRAND_MARK||'AP',
};

export const featureFlags={
  customer_web_ordering:process.env.NEXT_PUBLIC_FEATURE_CUSTOMER_WEB_ORDERING==='true',
  kitchen_display:process.env.NEXT_PUBLIC_FEATURE_KITCHEN_DISPLAY==='true',
  inventory:process.env.NEXT_PUBLIC_FEATURE_INVENTORY==='true',
  recipes:process.env.NEXT_PUBLIC_FEATURE_RECIPES==='true',
  delivery:process.env.NEXT_PUBLIC_FEATURE_DELIVERY==='true',
  qr_ordering:process.env.NEXT_PUBLIC_FEATURE_QR_ORDERING==='true',
};
