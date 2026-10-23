import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W=595.28,PAGE_H=841.89,MARGIN=42;
const GREEN=rgb(0.16,0.42,0.30),PALE=rgb(0.92,0.97,0.94),INK=rgb(0.12,0.16,0.14),MUTED=rgb(0.40,0.46,0.43),LINE=rgb(0.85,0.89,0.86),WHITE=rgb(1,1,1);
const safe=value=>String(value??'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[₹]/g,'INR ').replace(/[^\x20-\x7E]/g,' ').replace(/\s+/g,' ').trim();
const money=paise=>'INR '+(Number(paise||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateText=value=>{const d=new Date(value||Date.now());return Number.isNaN(d.getTime())?safe(value):d.toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric'})};
export function formatInvoicePhone(value){
  const digits=String(value??'').replace(/\D/g,'');
  return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;
}
const wrap=(text,font,size,width)=>{
  const words=safe(text).split(' '),lines=[];let line='';
  for(const word of words){if(!word)continue;const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)<=width){line=next;continue}
    if(line)lines.push(line);line=word;
    if(font.widthOfTextAtSize(line,size)>width){let chunk='';for(const c of line){if(font.widthOfTextAtSize(chunk+c,size)>width&&chunk){lines.push(chunk);chunk=c}else chunk+=c}line=chunk}
  }
  if(line)lines.push(line);return lines.length?lines:[''];
};
export async function createInvoicePdf(invoice){
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
    drawText(page,'ISSUED',MARGIN,y,7,bold,MUTED);drawText(page,dateText(invoice.issueDate),MARGIN,y-15,10,bold,INK);
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
    const nameLines=wrap(item.name,regular,8,gst?188:275),unit=money(item.unitPricePaise),gross=money(item.grossPaise),taxable=money(item.taxablePaise);
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
  const totalRows=gst?[['Taxable value',money(totals.taxablePaise)],...(totals.cgstPaise?[['CGST',money(totals.cgstPaise)]]:[]),...(totals.sgstPaise?[['SGST',money(totals.sgstPaise)]]:[]),...(totals.igstPaise?[['IGST',money(totals.igstPaise)]]:[])]:[['Items total',money(totals.grossPaise)]];
  const x=PAGE_W-MARGIN-245;
  for(const row of totalRows){drawText(page,row[0],x,y,9,regular,MUTED);drawRight(page,row[1],PAGE_W-MARGIN,y,9,bold,INK);y-=17}
  rect(page,x-8,y-29,245,32,GREEN);
  drawText(page,'TOTAL PAYABLE',x,y-18,9,bold,WHITE);drawRight(page,money(totals.totalPaise),PAGE_W-MARGIN-8,y-18,11,bold,WHITE);
  y-=48;
  drawText(page,'Payment method: Cash / offline',MARGIN,y,8,regular,MUTED);y-=13;
  drawText(page,'Payment status is tracked separately in My orders. This document does not by itself prove cash collection.',MARGIN,y,7,regular,MUTED);y-=20;
  if(invoice.documentType==='commercial_invoice')drawText(page,'Commercial invoice / order record - NOT A GST TAX INVOICE.',MARGIN,y,8,bold,MUTED);
  else if(invoice.documentType==='bill_of_supply')drawText(page,'Bill of supply. No GST has been separately charged on this document.',MARGIN,y,8,regular,MUTED);
  else drawText(page,'Original for recipient',MARGIN,y,8,regular,MUTED);
  footer();
  return await doc.save();
}
