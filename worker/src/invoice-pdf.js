import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W=595.28,PAGE_H=841.89,MARGIN=42;
const INK=rgb(0.12,0.16,0.14),MUTED=rgb(0.40,0.46,0.43),LINE=rgb(0.85,0.89,0.86),GREEN=rgb(0.16,0.42,0.30),PALE=rgb(0.92,0.97,0.94),WHITE=rgb(1,1,1);
const safe=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[₹]/g,'INR ').replace(/[^\x20-\x7E]/g,' ').replace(/\s+/g,' ').trim();
const money=paise=>(Number(paise||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateTimeText=value=>{
  const d=new Date(value||Date.now());
  if(Number.isNaN(d.getTime()))return safe(value);
  return d.toLocaleString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).replace(',','');
};
export function normalizeInvoicePaymentStatus(value){
  const status=String(value??'').trim().toLowerCase();
  if(status==='collected')return 'Collected';
  if(status==='refunded')return 'Refunded';
  if(status==='cancelled')return 'Cancelled';
  return 'Not Collected';
}

export function formatInvoicePhone(value){
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;
}

// Seller contact numbers use an explicit India country code on printed receipts.
// Customer phones intentionally use domestic 10-digit formatting above.
export function formatSellerPhone(value){
  const input=String(value??'').trim();
  const digits=input.replace(/\D/g,'');
  if(!digits)return '';
  if(digits.length===10)return '+91'+digits;
  if(digits.length===12&&digits.startsWith('91'))return '+'+digits;
  if(input.startsWith('+'))return '+'+digits;
  return digits;
}
const wrap=(text,font,size,width)=>{
  const words=safe(text).split(' '),lines=[];let line='';
  for(const word of words){
    if(!word)continue;
    const next=line?line+' '+word:word;
    if(font.widthOfTextAtSize(next,size)<=width){line=next;continue}
    if(line)lines.push(line);
    line=word;
    if(font.widthOfTextAtSize(line,size)>width){
      let chunk='';
      for(const c of line){
        if(font.widthOfTextAtSize(chunk+c,size)>width&&chunk){lines.push(chunk);chunk=c}else chunk+=c;
      }
      line=chunk;
    }
  }
  if(line)lines.push(line);
  return lines.length?lines:[''];
};
const productVolumeMl=value=>{
  const text=String(value??'').toLowerCase().replace(/,/g,'.').trim();
  const match=text.match(/(\d+(?:\.\d+)?)\s*(ml|millilit(?:er|re)s?|l|ltr|lit(?:er|re)s?)(?![a-z])/i);
  if(!match)return null;
  const amount=Number(match[1]);
  if(!Number.isFinite(amount))return null;
  return /^m/i.test(match[2])?amount:amount*1000;
};
const productLabel=(name,unit)=>{
  const label=String(name??'').trim(),u=String(unit??'').trim();
  if(!u)return safe(label);
  const normalize=value=>String(value).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(normalize(label).endsWith(normalize(u)))return safe(label);
  const labelVolume=productVolumeMl(label),unitVolume=productVolumeMl(u);
  if(labelVolume!==null&&unitVolume!==null&&Math.abs(labelVolume-unitVolume)<0.001)return safe(label);
  return safe(label)+' - '+safe(u);
};
// Draw ₹ as vector strokes because the embedded standard PDF fonts do not
// include the Unicode rupee glyph. This keeps the symbol visible in Android PDF viewers.
function drawRupee(page,x,baseline,size,color){
  // Compact vector ₹ mark matching the familiar printed Indian rupee glyph:
  // two top bars, an open curved bowl, and a separate diagonal lower leg.
  // Keep this vector-based so Android PDF viewers do not depend on font glyphs.
  const stroke=Math.max(0.72,size*0.09);
  const line=(x1,y1,x2,y2)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color,thickness:stroke,opacity:1});
  const s=size;
  // Parallel headline bars.
  line(x+0.02*s,baseline+0.91*s,x+0.98*s,baseline+0.91*s);
  line(x+0.02*s,baseline+0.66*s,x+0.92*s,baseline+0.66*s);
  // Left stem and the open upper bowl, leaving the lower-right side open.
  line(x+0.24*s,baseline+0.91*s,x+0.24*s,baseline+0.39*s);
  line(x+0.24*s,baseline+0.88*s,x+0.58*s,baseline+0.88*s);
  line(x+0.58*s,baseline+0.88*s,x+0.73*s,baseline+0.80*s);
  line(x+0.73*s,baseline+0.80*s,x+0.78*s,baseline+0.70*s);
  line(x+0.78*s,baseline+0.70*s,x+0.72*s,baseline+0.59*s);
  line(x+0.72*s,baseline+0.59*s,x+0.24*s,baseline+0.51*s);
  // Diagonal foot; the stem does not continue through this leg.
  line(x+0.38*s,baseline+0.45*s,x+0.91*s,baseline+0.08*s);
}
async function createReceiptPdf(invoice){
  const doc=await PDFDocument.create();
  doc.setTitle('FreshWay '+invoice.documentType.replaceAll('_',' ')+' '+invoice.invoiceNumber);
  doc.setAuthor(safe(invoice.seller.legalName||invoice.seller.storeName||'FreshWay'));
  doc.setSubject('Order '+invoice.orderId);
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const contentWidth=PAGE_W-MARGIN*2;
  const drawText=(page,text,x,y,size=9,font=regular,color=INK)=>page.drawText(safe(text),{x,y,size,font,color});
  const drawRight=(page,text,right,y,size=9,font=regular,color=INK)=>{
    const value=safe(text);
    drawText(page,value,right-font.widthOfTextAtSize(value,size),y,size,font,color);
  };
  const line=(page,x1,y1,x2,y2,color=LINE,thickness=0.8)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color,thickness});
  const rect=(page,x,y,width,height,color)=>page.drawRectangle({x,y,width,height,color});
  const drawAmountRight=(targetPage,paise,right,baseline,size=9,font=regular,color=INK)=>{
    const text=money(paise),textWidth=font.widthOfTextAtSize(text,size),symbolWidth=size*0.98,gap=2.5;
    const x=right-symbolWidth-gap-textWidth;
    drawRupee(targetPage,x,baseline,size*0.98,color);
    drawText(targetPage,text,x+symbolWidth+gap,baseline,size,font,color);
  };
  const drawAmountLeft=(targetPage,paise,x,baseline,size=9,font=regular,color=INK)=>{
    const symbolWidth=size*0.98,gap=2.5;
    drawRupee(targetPage,x,baseline,size*0.98,color);
    drawText(targetPage,money(paise),x+symbolWidth+gap,baseline,size,font,color);
  };
  const drawDiscountRight=(targetPage,paise,right,baseline,size=9,font=regular,color=INK)=>{
    const amount=money(Math.abs(Number(paise||0))),sign='-';
    const signWidth=font.widthOfTextAtSize(sign,size),textWidth=font.widthOfTextAtSize(amount,size);
    const symbolWidth=size*0.98,gap=2.5,x=right-signWidth-symbolWidth-gap-textWidth;
    drawText(targetPage,sign,x,baseline,size,font,color);
    drawRupee(targetPage,x+signWidth,baseline,size*0.98,color);
    drawText(targetPage,amount,x+signWidth+symbolWidth+gap,baseline,size,font,color);
  };
  const dateValue=invoice.buyer.orderCreatedAt||invoice.issueDate;
  const customerName=invoice.buyer.name||'Customer';
  const customerPhone=formatInvoicePhone(invoice.buyer.phone);
  const totalPaise=Number(invoice.totals.totalPaise??invoice.totals.grossPaise??0);
  const paymentStatusLabel=normalizeInvoicePaymentStatus(invoice.buyer.paymentStatus);
  const balanceDuePaise=paymentStatusLabel==='Not Collected'?totalPaise:0;
  const totalItems=(invoice.items||[]).reduce((sum,item)=>sum+Math.max(0,Number(item.qty)||0),0);
  const sellerName=invoice.seller.legalName||invoice.seller.storeName||'FreshWay';
  const sellerPhone=formatSellerPhone(invoice.seller.phone);
  const title='COMMERCIAL INVOICE';
  let page,y,pageNo=0;

  const footer=()=>{
    line(page,MARGIN,43,PAGE_W-MARGIN,43,LINE,0.7);
    drawText(page,'FreshWay | Commercial invoice - order record',MARGIN,29,7,regular,MUTED);
    drawRight(page,'Page '+pageNo,PAGE_W-MARGIN,29,7,regular,MUTED);
  };
  const newPage=(continued=false)=>{
    if(page)footer();
    page=doc.addPage([PAGE_W,PAGE_H]);
    pageNo++;
    rect(page,0,PAGE_H-86,PAGE_W,86,GREEN);
    drawText(page,'FreshWay',MARGIN,PAGE_H-40,22,bold,WHITE);
    drawText(page,'Eat Fresh, Stay Healthy',MARGIN,PAGE_H-59,8.5,regular,WHITE);
    drawRight(page,title,PAGE_W-MARGIN,PAGE_H-39,12.5,bold,WHITE);
    drawRight(page,invoice.invoiceNumber,PAGE_W-MARGIN,PAGE_H-58,8.5,regular,WHITE);
    y=PAGE_H-107;
    if(continued){
      drawText(page,'INVOICE DETAILS CONTINUED',MARGIN,y,8,bold,GREEN);
      drawRight(page,'Order '+invoice.orderId,PAGE_W-MARGIN,y,8,regular,MUTED);
      y-=22;
      return;
    }

    const cardGap=10,cardWidth=(contentWidth-cardGap*2)/3,cardHeight=45,top=y;
    const meta=[
      ['INVOICE DATE',dateTimeText(invoice.issueDate)],
      ['ORDER REFERENCE',invoice.orderId],
      ['ITEM COUNT',String(totalItems)+' item'+(totalItems===1?'':'s')]
    ];
    meta.forEach((entry,index)=>{
      const x=MARGIN+index*(cardWidth+cardGap);
      rect(page,x,top-cardHeight,cardWidth,cardHeight,PALE);
      drawText(page,entry[0],x+10,top-13,6.8,bold,GREEN);
      const valueLines=wrap(entry[1],bold,8.3,cardWidth-20).slice(0,2);
      valueLines.forEach((value,i)=>drawText(page,value,x+10,top-28-i*10,8.3,bold,INK));
    });
    y-=58;

    const gap=12,colWidth=(contentWidth-gap)/2,boxTop=y;
    const leftX=MARGIN,rightX=MARGIN+colWidth+gap;
    const sellerLines=[
      sellerName,
      invoice.seller.address?'Address: '+invoice.seller.address:'',
      invoice.seller.gstin?'Tax Number: '+invoice.seller.gstin:'',
      sellerPhone?'Contact Us: '+sellerPhone:''
    ].filter(Boolean).flatMap(value=>wrap(value,regular,8,colWidth-22)).slice(0,12);

    const buyer=invoice.buyer||{},address=buyer.address||{};
    const addressText=[address.house,address.building,address.floor,address.street,address.area,address.locality,address.city,address.district,address.state,address.pincode,address.landmark].filter(Boolean).join(', ');
    const deliveryPhone=formatInvoicePhone(address.deliveryPhone||buyer.deliveryPhone);
    const contactText=[
      buyer.name||customerName,
      customerPhone?'Customer Phone: '+customerPhone:'',
      address.recipientName&&address.recipientName!==customerName?'Recipient: '+address.recipientName:'',
      deliveryPhone&&deliveryPhone!==customerPhone?'Delivery: '+deliveryPhone:'',
      addressText
    ].filter(Boolean);
    const buyerLines=contactText.flatMap(value=>wrap(value,regular,8,colWidth-22)).slice(0,12);

    // Give billing/delivery details enough space for longer Indian addresses instead
    // of squeezing them into a small fixed-height box or silently dropping lines.
    const boxHeight=Math.max(118,Math.min(168,42+Math.max(sellerLines.length,buyerLines.length)*10.5));
    rect(page,leftX,boxTop-boxHeight,colWidth,boxHeight,PALE);
    rect(page,rightX,boxTop-boxHeight,colWidth,boxHeight,PALE);
    drawText(page,'ISSUED BY',leftX+11,boxTop-15,7,bold,GREEN);
    drawText(page,'BILL TO / DELIVER TO',rightX+11,boxTop-15,7,bold,GREEN);
    let sy=boxTop-31;
    for(const value of sellerLines){if(sy<boxTop-boxHeight+10)break;drawText(page,value,leftX+11,sy,8,regular,INK);sy-=10.5;}
    let by=boxTop-31;
    for(const value of buyerLines){if(by<boxTop-boxHeight+10)break;drawText(page,value,rightX+11,by,8,regular,INK);by-=10.5;}
    y-=boxHeight+13;
  };

  const drawItemsHeader=()=>{
    rect(page,MARGIN,y-24,contentWidth,24,PALE);
    drawText(page,'ITEM DESCRIPTION',MARGIN+9,y-15,7,bold,GREEN);
    drawRight(page,'QTY',MARGIN+300,y-15,7,bold,GREEN);
    drawRight(page,'UNIT PRICE',MARGIN+405,y-15,7,bold,GREEN);
    drawRight(page,'AMOUNT',PAGE_W-MARGIN-8,y-15,7,bold,GREEN);
    y-=31;
  };
  newPage(false);
  drawItemsHeader();

  for(const item of (invoice.items||[])){
    const description=productLabel(item.name,item.unit);
    const nameLines=wrap(description,regular,8.5,235);
    const rowHeight=Math.max(29,nameLines.length*10+15);
    if(y-rowHeight<300){
      newPage(true);
      drawItemsHeader();
    }
    nameLines.forEach((value,index)=>drawText(page,value,MARGIN+9,y-12-index*10,8.5,regular,INK));
    drawRight(page,String(item.qty??0),MARGIN+300,y-12,8.5,regular,INK);
    drawAmountRight(page,item.unitPricePaise,MARGIN+405,y-12,8.5,regular,INK);
    drawAmountRight(page,item.grossPaise,PAGE_W-MARGIN-8,y-12,8.5,bold,INK);
    line(page,MARGIN,y-rowHeight,PAGE_W-MARGIN,y-rowHeight,LINE,0.45);
    y-=rowHeight;
  }

  // Keep the entire order summary, payment information and seller footer together.
  if(y<360)newPage(true);
  line(page,MARGIN,y,PAGE_W-MARGIN,y,LINE,0.8);
  y-=17;
  drawText(page,'ORDER SUMMARY',MARGIN,y,7.5,bold,GREEN);
  y-=18;
  const summaryRows=invoice.totals.pricingBreakdownKnown===true
    ?[
      ['Items subtotal',invoice.totals.itemsSubtotalPaise??invoice.totals.grossPaise??totalPaise,'amount'],
      ...(Number(invoice.totals.couponDiscountPaise||0)>0?[['Coupon '+String(invoice.totals.couponCode||'').slice(0,32),invoice.totals.couponDiscountPaise,'discount']]:[]),
      ['Delivery fee',invoice.totals.deliveryFeePaise||0,'delivery']
    ]
    :[['Order total',totalPaise,'amount']];
  for(const [label,value,kind] of summaryRows){
    drawText(page,label,MARGIN,y,9,regular,MUTED);
    if(kind==='discount')drawDiscountRight(page,value,PAGE_W-MARGIN,y,9,regular,GREEN);
    else if(kind==='delivery'&&Number(value)===0)drawRight(page,'Free',PAGE_W-MARGIN,y,9,regular,GREEN);
    else drawAmountRight(page,value,PAGE_W-MARGIN,y,9,regular,INK);
    y-=17;
  }

  const totalBoxWidth=244,totalBoxHeight=33,totalBoxX=PAGE_W-MARGIN-totalBoxWidth;
  rect(page,totalBoxX,y-totalBoxHeight+4,totalBoxWidth,totalBoxHeight,GREEN);
  drawText(page,'TOTAL PAYABLE',totalBoxX+12,y-16,8.5,bold,WHITE);
  drawAmountRight(page,totalPaise,PAGE_W-MARGIN-12,y-16,10.5,bold,WHITE);
  y-=47;

  const paymentBoxHeight=57;
  rect(page,MARGIN,y-paymentBoxHeight,contentWidth,paymentBoxHeight,PALE);
  const paymentCol2=MARGIN+contentWidth*0.53;
  drawText(page,'PAYMENT',MARGIN+12,y-14,6.8,bold,GREEN);
  drawText(page,'Payment Type: Cash on delivery',MARGIN+12,y-30,8.2,regular,INK);
  drawText(page,'Payment status: '+paymentStatusLabel,MARGIN+12,y-44,8,regular,MUTED);
  drawText(page,'Balance due:',paymentCol2,y-25,8,regular,MUTED);
  drawAmountRight(page,balanceDuePaise,PAGE_W-MARGIN-12,y-25,8.4,bold,INK);
  drawText(page,paymentStatusLabel==='Not Collected'?'Collect on delivery':'No balance due',paymentCol2,y-42,7.4,regular,MUTED);
  y-=paymentBoxHeight+13;

  const noteText='Commercial invoice / order record. '+(invoice.seller.footer||'Thank you for shopping with FreshWay.');
  const noteLines=wrap(noteText,regular,7.6,contentWidth-22).slice(0,2);
  const noteHeight=23+noteLines.length*10;
  rect(page,MARGIN,y-noteHeight,contentWidth,noteHeight,PALE);
  drawText(page,'DOCUMENT NOTE',MARGIN+10,y-13,6.8,bold,GREEN);
  noteLines.forEach((value,index)=>drawText(page,value,MARGIN+10,y-26-index*10,7.6,regular,INK));
  y-=noteHeight+8;
  return await doc.save();
}

// Preserve the existing detailed GST-invoice and bill-of-supply rendering.
// Only commercial order records use the plain retail receipt layout above.
const formalMoney=paise=>'INR '+money(paise);
const formalDateText=value=>{
  const d=new Date(value||Date.now());
  return Number.isNaN(d.getTime())?safe(value):d.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'});
};
async function createFormalInvoicePdf(invoice){
  const doc=await PDFDocument.create();
  doc.setTitle('FreshWay '+invoice.documentType.replaceAll('_',' ')+' '+invoice.invoiceNumber);
  doc.setAuthor(safe(invoice.seller.legalName||'FreshWay'));
  doc.setSubject('Order '+invoice.orderId);
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const drawText=(page,text,x,y,size=9,font=regular,color=INK)=>page.drawText(safe(text),{x,y,size,font,color});
  const drawRight=(page,text,right,y,size=9,font=regular,color=INK)=>{const t=safe(text);page.drawText(t,{x:right-font.widthOfTextAtSize(t,size),y,size,font,color})};
  const line=(page,x1,y1,x2,y2,color=LINE,thickness=0.8)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color,thickness});
  const rect=(page,x,y,width,height,color)=>page.drawRectangle({x,y,width,height,color});
  const title=invoice.documentType==='gst_tax_invoice'?'TAX INVOICE':invoice.documentType==='bill_of_supply'?'BILL OF SUPPLY':'COMMERCIAL INVOICE';
  let page,y,pageNo=0;
  const footer=()=>{line(page,MARGIN,45,PAGE_W-MARGIN,45);drawText(page,invoice.seller.footer||'Thank you for shopping with FreshWay.',MARGIN,30,8,regular,MUTED);drawRight(page,'Page '+pageNo,PAGE_W-MARGIN,30,8,regular,MUTED)};
  const newPage=()=>{
    if(page)footer();page=doc.addPage([PAGE_W,PAGE_H]);pageNo++;
    rect(page,0,PAGE_H-84,PAGE_W,84,GREEN);
    drawText(page,'FreshWay',MARGIN,PAGE_H-42,22,bold,WHITE);
    drawText(page,'Eat Fresh, Stay Healthy',MARGIN,PAGE_H-61,8,regular,WHITE);
    drawRight(page,title,PAGE_W-MARGIN,PAGE_H-43,14,bold,WHITE);
    drawRight(page,invoice.invoiceNumber,PAGE_W-MARGIN,PAGE_H-61,8,regular,WHITE);
    y=PAGE_H-108;
    drawText(page,'ISSUED',MARGIN,y,7,bold,MUTED);drawText(page,formalDateText(invoice.issueDate),MARGIN,y-15,10,bold,INK);
    drawRight(page,'Order: '+invoice.orderId,PAGE_W-MARGIN,y,8,bold,INK);
    drawRight(page,'Financial year: '+invoice.financialYear,PAGE_W-MARGIN,y-15,8,regular,MUTED);
    y-=42;
    const colW=(PAGE_W-MARGIN*2-24)/2;
    rect(page,MARGIN,y-92,colW,92,PALE);rect(page,MARGIN+colW+24,y-92,colW,92,PALE);
    drawText(page,'SELLER',MARGIN+10,y-14,7,bold,GREEN);
    const stateLabel=invoice.seller.stateName?(invoice.seller.stateCode?'State: '+invoice.seller.stateName+' ('+invoice.seller.stateCode+')':'State: '+invoice.seller.stateName):'';
    const sellerLines=[invoice.seller.legalName,invoice.seller.address,stateLabel,invoice.seller.gstin?'GSTIN: '+invoice.seller.gstin:''].filter(Boolean);
    const sellerTextLines=sellerLines.flatMap(t=>wrap(t,regular,7.3,colW-20)).slice(0,6);
    let sy=y-27;for(const lineText of sellerTextLines){if(sy<y-84)break;drawText(page,lineText,MARGIN+10,sy,7.3,regular,INK);sy-=10}
    const rx=MARGIN+colW+24,b=invoice.buyer,a=b.address||{};
    drawText(page,'BILL TO / DELIVER TO',rx+10,y-14,7,bold,GREEN);
    const addressText=[a.house,a.building,a.floor,a.street,a.area,a.locality,a.city,a.district,a.state,a.pincode,a.landmark].filter(Boolean).join(', ');
    const customerPhone=formatInvoicePhone(b.phone),deliveryPhone=formatInvoicePhone(a.deliveryPhone);
    const contactText=[customerPhone?'Customer phone: '+customerPhone:'',a.recipientName&&a.recipientName!==b.name?'Recipient: '+a.recipientName:'',deliveryPhone&&deliveryPhone!==customerPhone?'Delivery: '+deliveryPhone:''].filter(Boolean).join(' · ');
    const placeText=b.placeOfSupply?'Place of supply: '+b.placeOfSupply+(b.stateCode?' ('+b.stateCode+')':''):'';
    const buyerLines=[b.name,contactText,addressText,placeText].filter(Boolean);
    const buyerTextLines=buyerLines.flatMap(t=>wrap(t,regular,7.3,colW-20)).slice(0,6);
    let by=y-27;for(const lineText of buyerTextLines){if(by<y-84)break;drawText(page,lineText,rx+10,by,7.3,regular,INK);by-=10}
    y-=111;
  };
  newPage();
  const gst=invoice.documentType==='gst_tax_invoice';
  const cols=gst
    ?[{name:'Item description',x:MARGIN+8},{name:'HSN',x:MARGIN+210},{name:'Qty',x:MARGIN+255},{name:'Taxable',x:MARGIN+294},{name:'GST %',x:MARGIN+360},{name:'Total',x:PAGE_W-MARGIN-8}]
    :[{name:'Item description',x:MARGIN+8},{name:'Qty',x:MARGIN+304},{name:'Unit price',x:MARGIN+350},{name:'Amount',x:PAGE_W-MARGIN-8}];
  const header=()=>{rect(page,MARGIN,y-20,PAGE_W-MARGIN*2,24,PALE);for(const c of cols){if(c.name==='Total'||c.name==='Amount')drawRight(page,c.name,PAGE_W-MARGIN-8,y-11,7,bold,GREEN);else drawText(page,c.name,c.x,y-11,7,bold,GREEN)}y-=29};
  header();
  for(const item of invoice.items){
    const nameLines=wrap(item.name,regular,8,gst?188:275),unit=formalMoney(item.unitPricePaise),gross=formalMoney(item.grossPaise),taxable=formalMoney(item.taxablePaise);
    const rowHeight=Math.max(23,nameLines.length*10+10);
    if(y-rowHeight<135){newPage();header()}
    line(page,MARGIN,y-4,PAGE_W-MARGIN,y-4);
    let ny=y-14;for(const name of nameLines){drawText(page,name,MARGIN+8,ny,8,regular,INK);ny-=10}
    if(gst){
      drawText(page,item.hsnCode,MARGIN+210,y-15,7,regular,INK);
      drawRight(page,String(item.qty)+' '+item.unit,MARGIN+287,y-15,7,regular,INK);
      drawRight(page,taxable,MARGIN+357,y-15,7,regular,INK);
      drawRight(page,(Number(item.gstRateBps||0)/100).toFixed(2)+'%',MARGIN+405,y-15,7,regular,INK);
      drawRight(page,gross,PAGE_W-MARGIN-8,y-15,7,bold,INK);
    }else{
      drawRight(page,String(item.qty)+' '+item.unit,MARGIN+340,y-15,7,regular,INK);
      drawRight(page,unit,MARGIN+415,y-15,7,regular,INK);
      drawRight(page,gross,PAGE_W-MARGIN-8,y-15,7,bold,INK);
    }
    y-=rowHeight;
  }
  if(y<205){newPage();header();y-=5}
  line(page,MARGIN,y,PAGE_W-MARGIN,y,LINE,1);y-=20;
  const totals=invoice.totals;
  const totalRows=gst?[['Taxable value',formalMoney(totals.taxablePaise)],...(totals.cgstPaise?[['CGST',formalMoney(totals.cgstPaise)]]:[]),...(totals.sgstPaise?[['SGST',formalMoney(totals.sgstPaise)]]:[]),...(totals.igstPaise?[['IGST',formalMoney(totals.igstPaise)]]:[])]:totals.pricingBreakdownKnown===true?[['Items subtotal',formalMoney(totals.itemsSubtotalPaise??totals.grossPaise)],...(Number(totals.couponDiscountPaise||0)>0?[['Coupon '+String(totals.couponCode||'').slice(0,24),'-'+formalMoney(totals.couponDiscountPaise)]]:[]),...(Number(totals.deliveryFeePaise||0)>0?[['Delivery fee',formalMoney(totals.deliveryFeePaise)]]:[])]:[['Order total',formalMoney(totals.totalPaise??totals.grossPaise)]];
  const x=PAGE_W-MARGIN-245;
  for(const row of totalRows){drawText(page,row[0],x,y,9,regular,MUTED);drawRight(page,row[1],PAGE_W-MARGIN,y,9,bold,INK);y-=17}
  rect(page,x-8,y-29,245,32,GREEN);
  drawText(page,'TOTAL PAYABLE',x,y-18,9,bold,WHITE);drawRight(page,formalMoney(totals.totalPaise),PAGE_W-MARGIN-8,y-18,11,bold,WHITE);
  y-=48;
  drawText(page,'Payment method: Cash / offline',MARGIN,y,8,regular,MUTED);y-=13;
  drawText(page,'Payment status is tracked separately in My orders. This document does not by itself prove cash collection.',MARGIN,y,7,regular,MUTED);y-=20;
  if(invoice.documentType==='commercial_invoice')drawText(page,'Commercial invoice / order record - NOT A GST TAX INVOICE.',MARGIN,y,8,bold,MUTED);
  else if(invoice.documentType==='bill_of_supply')drawText(page,'Bill of supply. No GST has been separately charged on this document.',MARGIN,y,8,regular,MUTED);
  else drawText(page,'Original for recipient',MARGIN,y,8,regular,MUTED);
  footer();
  return await doc.save();
}


export async function createInvoicePdf(invoice){
  if(invoice.documentType==='commercial_invoice')return createReceiptPdf(invoice);
  return createFormalInvoicePdf(invoice);
}
