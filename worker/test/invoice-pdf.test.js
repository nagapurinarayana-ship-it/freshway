import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { createInvoicePdf, formatInvoicePhone, formatSellerPhone } from '../src/invoice-pdf.js';

const invoicePdfSource = readFileSync(new URL('../src/invoice-pdf.js', import.meta.url), 'utf8');

function saveVisualSample(name, bytes) {
  if (process.env.FRESHWAY_VISUAL_ARTIFACTS !== '1') return;
  mkdirSync('test-results/visual-review', { recursive: true });
  writeFileSync('test-results/visual-review/' + name, bytes);
}

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
  saveVisualSample('commercial-invoice.pdf', bytes);
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

test('creates a realistic commercial invoice visual sample with long addresses, fixed coupon, delivery fee and collected payment',async()=>{
  const base=fixture();
  const invoice=fixture({
    seller:{...base.seller,address:'Shop No. 12, Sri Sai Commercial Complex, Old Market Road, Main Bazaar, Nennel Mandal, Mancherial District, Telangana 504204'},
    buyer:{...base.buyer,name:'Sample Customer',phone:'919876543210',deliveryPhone:'9876543210',paymentStatus:'collected',address:{
      house:'Plot 21, Flat 403',building:'Lakshmi Residency',floor:'Fourth Floor',street:'Road No. 4',
      area:'Green Valley Layout',locality:'Near Government School',city:'Hyderabad',district:'Medchal-Malkajgiri',
      state:'Telangana',pincode:'500081',landmark:'Opposite the community health centre, beside the water tank',
      recipientName:'Delivery Recipient'
    }},
    items:[
      {...base.items[0],productId:'oil-5l',name:'Groundnut Oil',unit:'5 litre can',qty:1,unitPricePaise:165000,grossPaise:165000,taxablePaise:165000},
      {...base.items[0],productId:'rice-1kg',name:'Basmati Rice',unit:'1 kg bag',qty:2,unitPricePaise:10000,grossPaise:20000,taxablePaise:20000}
    ],
    totals:{grossPaise:185000,itemsSubtotalPaise:185000,couponDiscountPaise:5000,couponCode:'FIXED50',deliveryFeePaise:3000,totalPaise:183000,taxablePaise:185000,cgstPaise:0,sgstPaise:0,igstPaise:0,currency:'INR',pricesIncludeTax:true,pricingBreakdownKnown:true}
  });
  const bytes=await createInvoicePdf(invoice);
  saveVisualSample('commercial-invoice-pricing-payment.pdf',bytes);
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),1,'the normal multi-item invoice with longer Indian addresses should fit on one A4 page');
  assert.ok(bytes.length>1000);
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
    totals:{grossPaise:gross,itemsSubtotalPaise:gross,couponDiscountPaise:0,deliveryFeePaise:3000,taxablePaise:gross,cgstPaise:0,sgstPaise:0,igstPaise:0,totalPaise:gross+3000,currency:'INR',pricesIncludeTax:true,pricingBreakdownKnown:true}
  });
  const bytes=await createInvoicePdf(invoice);
  saveVisualSample('commercial-invoice-multipage.pdf',bytes);
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
