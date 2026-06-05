/**
 * Maps domain field names to exact Digitify Excel column header strings.
 * All column names match the "Supplier Advance" sheet exported from Digitify.
 * Update this file if Digitify changes export headers — nothing else needs changing.
 */

/** Source columns — read from Digitify BASE file (all required unless marked optional) */
export const SOURCE_COLUMNS = {
  // Identity
  id:              'Id',
  date:            'Date',
  sOut:            'S-out',
  invoiceNo:       'Invoice No',     // optional
  verifiedBy:      'Verified By',    // optional
  approver:        'Approver',       // optional
  payTo:           'Pay To',
  accountNo:       'Account No',
  beneficiaryName: 'Beneficiary Name',
  ifscNo:          'IFSC No',
  branchName:      'Branch Name',
  status:          'Status',
  aging:           'Aging',
  lrNo:            'LR No',          // optional
  customer:        'Customer',
  supplier:        'Supplier',
  source:          'Source',
  destination:     'Destination',
  truck:           'Truck',
  truckType:       'Truck Type',
  driverPhone:     'Driver',
  tripStatus:      'Trip Status',
  hireChallan:     'Hire Challan',   // optional
  cPrice:          'C price',
  price:           'Price',
  profit:          'Profit',
  profitPct:       'Profit %',
  mamul:           'Mamul',
  netPrice:        'Net Price',
  advance:         'Advance',
  plus:            'Plus',           // optional
  minus:           'Minus',          // optional
  tds:             'TDS',
  payable:         'Payable',
} as const;

/** APO-computed columns — inserted into the output workbook by APO */
export const COMPUTED_COLUMNS = {
  remarks:       'Remarks',
  ninetyPercent: 0.9,           // numeric header as in the real processed file
  dc:            'Dc',
  tdsCalc:       'tds',
  finalAdvance:  'Final advance',
  verification:  'T/F',
  /** Internal / margin-review export only — omitted from final Vendor workbook (master automation). */
  margin:        'Margin',
} as const;

export type SourceColumnKey = keyof typeof SOURCE_COLUMNS;
export type SourceColumnValue = (typeof SOURCE_COLUMNS)[SourceColumnKey];

/** Required source columns — parse fails if any are missing from the Excel */
export const REQUIRED_SOURCE_COLUMNS: SourceColumnKey[] = [
  'id', 'date', 'sOut', 'payTo', 'accountNo', 'beneficiaryName',
  'ifscNo', 'branchName', 'status', 'aging', 'customer', 'supplier',
  'source', 'destination', 'truck', 'truckType', 'driverPhone', 'tripStatus',
  'cPrice', 'price', 'profit', 'profitPct', 'mamul', 'netPrice',
  'advance', 'tds', 'payable',
];

/**
 * Output column order for the processed workbook.
 * Columns 1–24: source columns up to and including C price
 * Column 25: Remarks (APO)
 * Column 26: Price (source, moved after Remarks)
 * Columns 27–30: APO computed (0.9, Dc, tds, Final advance)
 * Columns 31–39: remaining source columns (Profit through Payable)
 * Column 40: T/F verification (APO)
 */
export const SOURCE_COLUMNS_BEFORE_PRICE: SourceColumnKey[] = [
  'id', 'date', 'sOut', 'invoiceNo', 'verifiedBy', 'approver',
  'payTo', 'accountNo', 'beneficiaryName', 'ifscNo', 'branchName',
  'status', 'aging', 'lrNo', 'customer', 'supplier', 'source',
  'destination', 'truck', 'truckType', 'driverPhone', 'tripStatus',
  'hireChallan', 'cPrice',
];

export const SOURCE_COLUMNS_AFTER_PRICE: SourceColumnKey[] = [
  'profit', 'profitPct', 'mamul', 'netPrice', 'advance', 'plus', 'minus', 'tds', 'payable',
];
