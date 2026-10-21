// Instrument master seed: NIFTY 50-style large caps plus benchmark indices.
// Reference prices are illustrative starting points for the simulator, not real quotes.

export interface InstrumentSeed {
  symbol: string;
  name: string;
  sector: string;
  price: number; // rupees
  exchange?: 'NSE' | 'BSE';
  type?: 'EQUITY' | 'INDEX';
}

export const EQUITIES: InstrumentSeed[] = [
  // Banking & financial services
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', price: 1650.25 },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', price: 1245.3 },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', price: 812.45 },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking', price: 1170.9 },
  { symbol: 'KOTAKBANK', name: 'Kotak Mahindra Bank', sector: 'Banking', price: 1780.4 },
  { symbol: 'INDUSINDBK', name: 'IndusInd Bank', sector: 'Banking', price: 985.3 },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'NBFC', price: 7150.0 },
  { symbol: 'BAJAJFINSV', name: 'Bajaj Finserv', sector: 'Financial Services', price: 1640.2 },
  { symbol: 'SHRIRAMFIN', name: 'Shriram Finance', sector: 'NBFC', price: 620.35 },
  { symbol: 'JIOFIN', name: 'Jio Financial Services', sector: 'NBFC', price: 315.6 },
  { symbol: 'HDFCLIFE', name: 'HDFC Life Insurance', sector: 'Insurance', price: 690.55 },
  { symbol: 'SBILIFE', name: 'SBI Life Insurance', sector: 'Insurance', price: 1520.8 },

  // IT
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', price: 4120.0 },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', price: 1875.6 },
  { symbol: 'HCLTECH', name: 'HCL Technologies', sector: 'IT', price: 1720.45 },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', price: 545.2 },
  { symbol: 'TECHM', name: 'Tech Mahindra', sector: 'IT', price: 1590.1 },

  // Energy, power & mining
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Oil & Gas', price: 2945.5 },
  { symbol: 'ONGC', name: 'Oil & Natural Gas Corporation', sector: 'Oil & Gas', price: 265.8 },
  { symbol: 'NTPC', name: 'NTPC', sector: 'Power', price: 365.2 },
  { symbol: 'POWERGRID', name: 'Power Grid Corporation', sector: 'Power', price: 312.45 },
  { symbol: 'COALINDIA', name: 'Coal India', sector: 'Mining', price: 415.3 },

  // Metals & materials
  { symbol: 'TATASTEEL', name: 'Tata Steel', sector: 'Metals', price: 152.65 },
  { symbol: 'JSWSTEEL', name: 'JSW Steel', sector: 'Metals', price: 985.4 },
  { symbol: 'HINDALCO', name: 'Hindalco Industries', sector: 'Metals', price: 655.9 },
  { symbol: 'ULTRACEMCO', name: 'UltraTech Cement', sector: 'Cement', price: 11250.0 },
  { symbol: 'GRASIM', name: 'Grasim Industries', sector: 'Cement', price: 2640.75 },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Paints', price: 2980.35 },

  // Automobile
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Automobile', price: 12450.0 },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Automobile', price: 985.7 },
  { symbol: 'EICHERMOT', name: 'Eicher Motors', sector: 'Automobile', price: 5410.25 },
  { symbol: 'HEROMOTOCO', name: 'Hero MotoCorp', sector: 'Automobile', price: 4520.6 },
  { symbol: 'BAJAJ-AUTO', name: 'Bajaj Auto', sector: 'Automobile', price: 8750.0 },

  // FMCG & consumer
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', price: 2710.4 },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', price: 498.35 },
  { symbol: 'NESTLEIND', name: 'Nestle India', sector: 'FMCG', price: 2380.5 },
  { symbol: 'BRITANNIA', name: 'Britannia Industries', sector: 'FMCG', price: 5420.0 },
  { symbol: 'TATACONSUM', name: 'Tata Consumer Products', sector: 'FMCG', price: 1085.25 },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer', price: 3480.5 },
  { symbol: 'TRENT', name: 'Trent', sector: 'Retail', price: 5380.4 },
  { symbol: 'ZOMATO', name: 'Zomato', sector: 'Consumer Tech', price: 245.6 },

  // Pharma & healthcare
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'Pharma', price: 1780.15 },
  { symbol: 'CIPLA', name: 'Cipla', sector: 'Pharma', price: 1495.6 },
  { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories", sector: 'Pharma', price: 1265.4 },
  { symbol: 'DIVISLAB', name: "Divi's Laboratories", sector: 'Pharma', price: 5980.5 },
  { symbol: 'APOLLOHOSP', name: 'Apollo Hospitals', sector: 'Healthcare', price: 7020.0 },

  // Industrials, telecom & infrastructure
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Construction', price: 3620.0 },
  { symbol: 'BEL', name: 'Bharat Electronics', sector: 'Defence', price: 395.15 },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', sector: 'Infrastructure', price: 1420.75 },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', price: 1590.8 },
];

export const INDICES: InstrumentSeed[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', sector: 'Index', price: 24850.4, type: 'INDEX' },
  { symbol: 'BANKNIFTY', name: 'NIFTY BANK', sector: 'Index', price: 51630.8, type: 'INDEX' },
  { symbol: 'SENSEX', name: 'S&P BSE SENSEX', sector: 'Index', price: 81420.15, type: 'INDEX', exchange: 'BSE' },
];
