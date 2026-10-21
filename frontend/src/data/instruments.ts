// Simulated instrument master. Prices and fundamentals are illustrative only.

export interface Instrument {
  symbol: string;
  name: string;
  sector: string;
  basePrice: number; // previous close
  pe: number;
  marketCap: string;
  color: string; // logo badge colour
}

export interface IndexInstrument {
  symbol: string;
  name: string;
  basePrice: number;
}

export const STOCKS: Instrument[] = [
  { symbol: 'RELIANCE', name: 'Reliance Industries', sector: 'Oil & Gas', basePrice: 2945.5, pe: 28.4, marketCap: '₹19.9L Cr', color: '#0f4c81' },
  { symbol: 'TCS', name: 'Tata Consultancy Services', sector: 'IT', basePrice: 4120.0, pe: 31.2, marketCap: '₹14.9L Cr', color: '#1d4ed8' },
  { symbol: 'HDFCBANK', name: 'HDFC Bank', sector: 'Banking', basePrice: 1650.25, pe: 18.6, marketCap: '₹12.6L Cr', color: '#004c8f' },
  { symbol: 'INFY', name: 'Infosys', sector: 'IT', basePrice: 1875.6, pe: 27.9, marketCap: '₹7.8L Cr', color: '#007cc3' },
  { symbol: 'ICICIBANK', name: 'ICICI Bank', sector: 'Banking', basePrice: 1245.3, pe: 18.9, marketCap: '₹8.8L Cr', color: '#b02a30' },
  { symbol: 'SBIN', name: 'State Bank of India', sector: 'Banking', basePrice: 812.45, pe: 10.1, marketCap: '₹7.2L Cr', color: '#2d5fa8' },
  { symbol: 'BHARTIARTL', name: 'Bharti Airtel', sector: 'Telecom', basePrice: 1590.8, pe: 74.5, marketCap: '₹9.5L Cr', color: '#e40000' },
  { symbol: 'ITC', name: 'ITC', sector: 'FMCG', basePrice: 498.35, pe: 29.8, marketCap: '₹6.2L Cr', color: '#3c4a9c' },
  { symbol: 'LT', name: 'Larsen & Toubro', sector: 'Construction', basePrice: 3620.0, pe: 36.1, marketCap: '₹5.0L Cr', color: '#c99a06' },
  { symbol: 'HINDUNILVR', name: 'Hindustan Unilever', sector: 'FMCG', basePrice: 2710.4, pe: 60.2, marketCap: '₹6.4L Cr', color: '#1f36c7' },
  { symbol: 'TATAMOTORS', name: 'Tata Motors', sector: 'Automobile', basePrice: 985.7, pe: 10.8, marketCap: '₹3.6L Cr', color: '#486aa1' },
  { symbol: 'WIPRO', name: 'Wipro', sector: 'IT', basePrice: 545.2, pe: 24.3, marketCap: '₹2.8L Cr', color: '#7c3aed' },
  { symbol: 'AXISBANK', name: 'Axis Bank', sector: 'Banking', basePrice: 1170.9, pe: 13.7, marketCap: '₹3.6L Cr', color: '#97144d' },
  { symbol: 'MARUTI', name: 'Maruti Suzuki', sector: 'Automobile', basePrice: 12450.0, pe: 27.5, marketCap: '₹3.9L Cr', color: '#173f8a' },
  { symbol: 'SUNPHARMA', name: 'Sun Pharmaceutical', sector: 'Pharma', basePrice: 1780.15, pe: 40.6, marketCap: '₹4.3L Cr', color: '#d97706' },
  { symbol: 'ZOMATO', name: 'Zomato', sector: 'Consumer Tech', basePrice: 245.6, pe: 290.0, marketCap: '₹2.2L Cr', color: '#e23744' },
  { symbol: 'BAJFINANCE', name: 'Bajaj Finance', sector: 'NBFC', basePrice: 7150.0, pe: 29.1, marketCap: '₹4.4L Cr', color: '#0d4c92' },
  { symbol: 'ASIANPAINT', name: 'Asian Paints', sector: 'Paints', basePrice: 2980.35, pe: 52.4, marketCap: '₹2.9L Cr', color: '#d6336c' },
  { symbol: 'TITAN', name: 'Titan Company', sector: 'Consumer', basePrice: 3480.5, pe: 88.7, marketCap: '₹3.1L Cr', color: '#7a4b1e' },
  { symbol: 'ADANIPORTS', name: 'Adani Ports & SEZ', sector: 'Infrastructure', basePrice: 1420.75, pe: 32.6, marketCap: '₹3.1L Cr', color: '#0b6e4f' },
];

export const INDICES: IndexInstrument[] = [
  { symbol: 'NIFTY', name: 'NIFTY 50', basePrice: 24850.4 },
  { symbol: 'SENSEX', name: 'SENSEX', basePrice: 81420.15 },
  { symbol: 'BANKNIFTY', name: 'BANK NIFTY', basePrice: 51630.8 },
];

export const STOCK_MAP: Record<string, Instrument> = Object.fromEntries(STOCKS.map((s) => [s.symbol, s]));

export const MOST_TRADED = ['RELIANCE', 'ZOMATO', 'TATAMOTORS', 'HDFCBANK'];
