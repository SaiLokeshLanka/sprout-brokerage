/** Shapes of the API responses the tests use (only the fields tests look at). Money is in paise. */

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  kycStatus: 'PENDING' | 'VERIFIED';
}

export interface Session {
  accessToken: string;
  user: PublicUser;
}

export interface Wallet {
  balancePaise: number;
  blockedPaise: number;
  currency: string;
}

export type OrderStatus = 'TRIGGER_PENDING' | 'OPEN' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' | 'REJECTED';

export interface Order {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
  qty: number;
  limitPricePaise: number | null;
  triggerPricePaise: number | null;
  status: OrderStatus;
  fillPricePaise: number | null;
  blockedPaise: number;
  chargesPaise: number;
  statusReason: string | null;
}

export interface PlaceOrder {
  symbol: string;
  side: 'BUY' | 'SELL';
  orderType: 'MARKET' | 'LIMIT' | 'SL' | 'SL_M';
  qty: number;
  limitPricePaise?: number;
  triggerPricePaise?: number;
  product?: 'DELIVERY' | 'INTRADAY';
}

export interface Charges {
  brokeragePaise: number;
  sttPaise: number;
  exchangePaise: number;
  sebiPaise: number;
  stampDutyPaise: number;
  gstPaise: number;
  totalPaise: number;
}

export interface OrderPreview {
  pricePaise: number;
  valuePaise: number;
  charges: Charges;
  totalPaise: number;
  sufficientFunds: boolean;
}

export interface Gtt {
  id: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  kind: 'SINGLE' | 'OCO';
  status: 'ACTIVE' | 'TRIGGERED' | 'CANCELLED' | 'EXPIRED' | 'FAILED';
  triggeredLeg: 'SINGLE' | 'TARGET' | 'STOPLOSS' | null;
  orderId: string | null;
  expiresAt: string;
}

export interface Quote {
  symbol: string;
  ltpPaise: number;
  prevClosePaise: number;
  upperCircuitPaise: number | null;
  lowerCircuitPaise: number | null;
}

export interface OptionQuote {
  symbol: string;
  name: string;
  kind: 'CE' | 'PE';
  strikePaise: number;
  lotSize: number;
  ltpPaise: number;
  delta: number;
  theta: number;
}

export interface OptionChain {
  underlying: string;
  spotPaise: number;
  expiry: string;
  expiries: string[];
  lotSize: number;
  atmStrikePaise: number;
  rows: { strikePaise: number; call: OptionQuote; put: OptionQuote }[];
}

export interface Holding {
  symbol: string;
  segment: 'EQUITY' | 'OPTIONS';
  qty: number;
  reservedQty: number;
  avgPricePaise: number;
  pnlPaise: number;
}
