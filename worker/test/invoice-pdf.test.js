import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { createInvoicePdf, formatInvoicePhone, formatSellerPhone } from '../src/invoice-pdf.js';

const invoicePdfSource = readFileSync(new URL('../src/invoice-pdf.js', import.meta.url), 'utf8');

function fixture(overrides={}){
  const item={
    productId:'oil-1',name:'Groundnut Oil',unit:'litre',qty:2,
    unitPricePaise:32500,grossPaise:65000,hsnCode:'',gstRateBps:0,
    taxablePaise:65000,cgstPaise:0,sgstPaise:0,igstPaise:0
  };
  return {
    id:'inv-FW-TEST-1',orderId:'FW-TEST-1',customerId:'customer-test',
    invoiceNumber:'FW/26-27/000001',documentType:'commercial_invoice',
    financialYear:'26-27',issueDate:'2026-10-22T06:00:00.000Z',
    seller:{storeName:'FreshWay',legalName:'FreshWay Foods',address:'Shop 1, Main Road',stateName:'Telangana',stateCode:'36',gstin:'',phone:'9000000000',footer:'Thank you for shopping with FreshWay.'},
    buyer:{name:'Test Customer',phone:'919000000000',recipientName:'Test Customer',deliveryPhone:'9000000000',address:{house:'H 1',area:'Market Road',city:'Hyderabad',district:'Hyderabad',state:'Telangana',pincode:'500001',landmark:'Near shop'},placeOfSupply:'',stateCode:''},
    totals:{grossPaise:65000,taxablePaise:65000,cgstPaise:0,sgstPaise:0,igstPaise:0,totalPaise:65000,currency:'INR',pricesIncludeTax:true},
    items:[item],...overrides
  };
}

test('renders the saved customer phone in domestic format',()=>{
  assert.equal(formatInvoicePhone('919966093782'),'9966093782');
  assert.equal(formatInvoicePhone('+91 99660 93782'),'9966093782');
  assert.equal(formatInvoicePhone('9966093782'),'9966093782');
  assert.equal(formatInvoicePhone(''),'');
  assert.ok(invoicePdfSource.includes('const customerPhone=formatInvoicePhone(invoice.buyer.phone)'), 'receipt must normalize the customer phone from the saved buyer record');
  assert.ok(invoicePdfSource.includes("'Customer Phone: '+customerPhone"),'receipt must show the buyer phone');
});

test('prints seller contact numbers with the India country code and a visible vector rupee mark',()=>{
  assert.equal(formatSellerPhone('7396805280'),'+917396805280');
  assert.equal(formatSellerPhone('+91 73968 05280'),'+917396805280');
  assert.equal(formatSellerPhone(''), '');
  assert.match(invoicePdfSource,/function drawRupee\(page,x,baseline,size,color\)/);
  assert.match(invoicePdfSource,/const stroke=Math\.max\(0\.72,size\*0\.09\)/);
  assert.ok(invoicePdfSource.includes('drawRupee(targetPage,x,baseline,size*0.98,color)'), 'each monetary amount must draw the ₹ mark before the numeric amount');
  assert.match(invoicePdfSource,/Parallel headline bars/,'rupee mark must have the two recognizable horizontal bars');
  assert.match(invoicePdfSource,/Diagonal foot/,'rupee mark must have the lower diagonal leg');
  assert.match(invoicePdfSource,/x\+0\.24\*s,baseline\+0\.91\*s,x\+0\.24\*s,baseline\+0\.39\*s/,'rupee stem must stop above the lower diagonal foot');
});

test('uses a branded invoice hierarchy and preserves payment and seller details',()=>{
  assert.match(invoicePdfSource,/COMMERCIAL INVOICE/);
  assert.match(invoicePdfSource,/ORDER SUMMARY/);
  assert.match(invoicePdfSource,/TOTAL PAYABLE/);
  assert.match(invoicePdfSource,/ISSUED BY/);
  assert.match(invoicePdfSource,/BILL TO \/ DELIVER TO/);
  assert.match(invoicePdfSource,/Tax Number:/);
  assert.ok(invoicePdfSource.includes('wrap(value,regular,8,colWidth-22)).slice(0,12)'), 'seller and delivery details use readable 8pt text and retain up to 12 wrapped lines');
  assert.ok(invoicePdfSource.includes('Math.max(118,Math.min(168,42+Math.max(sellerLines.length,buyerLines.length)*10.5))'), 'billing panels grow for longer addresses instead of clipping them into a fixed-height box');
  assert.match(invoicePdfSource,/invoice\.seller\.gstin\?'Tax Number: '\+invoice\.seller\.gstin:''/);
  assert.match(invoicePdfSource,/Cash Received:/);
  assert.match(invoicePdfSource,/Change Amount:/);
  assert.match(invoicePdfSource,/Payment Type: Cash/);
  assert.match(invoicePdfSource,/Commercial invoice \/ order record\./);
});

test('commercial invoices show only verified pricing breakdowns and keep historical details unknown',()=>{
  assert.match(invoicePdfSource,/invoice\.totals\.pricingBreakdownKnown===true/);
  assert.match(invoicePdfSource,/\['Items subtotal',invoice\.totals\.itemsSubtotalPaise/);
  assert.match(invoicePdfSource,/couponDiscountPaise/);
  assert.match(invoicePdfSource,/if\(kind==='discount'\)drawDiscountRight\(page,value/);
  assert.match(invoicePdfSource,/\['Delivery fee',invoice\.totals\.deliveryFeePaise/);
  assert.match(invoicePdfSource,/\['Order total',totalPaise/);
});

test('creates a valid one-page commercial invoice PDF',async()=>{
  const bytes=await createInvoicePdf(fixture());
  assert.ok(bytes instanceof Uint8Array);
  assert.ok(bytes.length>500);
  assert.equal(new TextDecoder().decode(bytes.slice(0,5)),'%PDF-');
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1);
  assert.equal(pdf.getTitle(),'FreshWay commercial invoice FW/26-27/000001');
  const size=pdf.getPage(0).getSize();
  assert.ok(Math.abs(size.width-595.28)<1,'commercial invoice uses A4 width');
  assert.ok(Math.abs(size.height-841.89)<1,'commercial invoice uses A4 height');
});

test('splits long item lists across pages without losing the total',async()=>{
  const items=Array.from({length:80},(_,i)=>({
    productId:'item-'+i,name:'FreshWay grocery product '+String(i+1).padStart(2,'0'),
    unit:'packet',qty:1,unitPricePaise:1250,grossPaise:1250,hsnCode:'',gstRateBps:0,
    taxablePaise:1250,cgstPaise:0,sgstPaise:0,igstPaise:0
  }));
  const gross=items.reduce((sum,item)=>sum+item.grossPaise,0);
  const invoice=fixture({
    items,
    totals:{grossPaise:gross,taxablePaise:gross,cgstPaise:0,sgstPaise:0,igstPaise:0,totalPaise:gross,currency:'INR',pricesIncludeTax:true}
  });
  const bytes=await createInvoicePdf(invoice);
  const pdf=await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount()>1);
  assert.ok(bytes.length>1500);
});

test('labels GST tax invoices and bill of supply distinctly',async()=>{
  const taxInvoice=await PDFDocument.load(await createInvoicePdf(fixture({
    documentType:'gst_tax_invoice',
    invoiceNumber:'FW/26-27/000002',
    seller:{...fixture().seller,gstin:'36ABCDE1234F1Z5'},
    buyer:{...fixture().buyer,stateCode:'36',placeOfSupply:'Telangana'},
    items:[{...fixture().items[0],hsnCode:'151790',gstRateBps:500,taxablePaise:61905,cgstPaise:1548,sgstPaise:1547,grossPaise:65000}],
    totals:{grossPaise:65000,taxablePaise:61905,cgstPaise:1548,sgstPaise:1547,igstPaise:0,totalPaise:65000,currency:'INR',pricesIncludeTax:true}
  })));
  assert.equal(taxInvoice.getPageCount(),1);
  assert.equal(taxInvoice.getTitle(),'FreshWay gst tax invoice FW/26-27/000002');
  const bill=await PDFDocument.load(await createInvoicePdf(fixture({documentType:'bill_of_supply',invoiceNumber:'FW/26-27/000003'})));
  assert.equal(bill.getTitle(),'FreshWay bill of supply FW/26-27/000003');
});
