import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const PAGE_W=595.28,PAGE_H=841.89,MARGIN=42;
const INK=rgb(0.12,0.16,0.14),MUTED=rgb(0.40,0.46,0.43);
const safe=value=>String(value??'').normalize('NFKD').replace(/[\\u0300-\\u036f]/g,'').replace(/[₹]/g,'INR ').replace(/[^\\x20-\\x7E]/g,' ').replace(/\\s+/g,' ').trim();
const money=paise=>(Number(paise||0)/100).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
const dateTimeText=value=>{
  const d=new Date(value||Date.now());
  if(Number.isNaN(d.getTime()))return safe(value);
  return d.toLocaleString('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).replace(',','');
};
export function formatInvoicePhone(value){
  const digits=String(value??'').replace(/\\D/g,'');
  return digits.length===12&&digits.startsWith('91')?digits.slice(2):digits;
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
  const match=text.match(/(\\d+(?:\\.\\d+)?)\\s*(ml|millilit(?:er|re)s?|l|ltr|lit(?:er|re)s?)(?![a-z])/i);
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
function drawRupee(page,x,baseline,size,color){
  const stroke=Math.max(0.5,size*0.065);
  const line=(x1,y1,x2,y2)=>page.drawLine({start:{x:x1,y:y1},end:{x:x2,y:y2},color,thickness:stroke});
  const s=size;
  line(x+0.04*s,baseline+0.82*s,x+0.88*s,baseline+0.82*s);
  line(x+0.04*s,baseline+0.61*s,x+0.82*s,baseline+0.61*s);
  line(x+0.20*s,baseline+0.86*s,x+0.20*s,baseline+0.12*s);
  line(x+0.20*s,baseline+0.86*s,x+0.59*s,baseline+0.86*s);
  line(x+0.59*s,baseline+0.86*s,x+0.76*s,baseline+0.73*s);
  line(x+0.76*s,baseline+0.73*s,x+0.68*s,baseline+0.61*s);
  line(x+0.68*s,baseline+0.61*s,x+0.20*s,baseline+0.55*s);
  line(x+0.37*s,baseline+0.53*s,x+0.82*s,baseline+0.12*s);
}
export async function createInvoicePdf(invoice){
  const doc=await PDFDocument.create();
  doc.setTitle('FreshWay '+invoice.documentType.replaceAll('_',' ')+' '+invoice.invoiceNumber);
  doc.setAuthor(safe(invoice.seller.legalName||invoice.seller.storeName||''));
  doc.setSubject('Order '+invoice.orderId);
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const contentWidth=PAGE_W-MARGIN*2;
  const drawText=(page,text,x,y,size=9,font=regular,color=INK)=>page.drawText(safe(text),{x,y,size,font,color});
  const drawAmountRight=(page,paise,right,y,size=9,font=regular,color=INK)=>{
    const text=money(paise),textWidth=font.widthOfTextAtSize(text,size),symbolWidth=size*0.82,gap=3;
    const x=right-symbolWidth-gap-textWidth;
    drawRupee(page,x,y,size*0.88,color);
    drawText(page,text,x+symbolWidth+gap,y,size,font,color);
  };
  const drawAmountAt=(page,paise,x,y,size=9,font=regular,color=INK)=>{
    const symbolWidth=size*0.82,gap=3;
    drawRupee(page,x,y,size*0.88,color);
    drawText(page,money(paise),x+symbolWidth+gap,y,size,font,color);
  };
  let page,y;
  const separator=()=>{
    drawText(page,'------------------------------------------------------------',MARGIN,y,8,regular,MUTED);
    y-=14;
  };
  const dateValue=invoice.buyer.orderCreatedAt||invoice.issueDate;
  const customerName=invoice.buyer.name||'Customer';
  const customerPhone=formatInvoicePhone(invoice.buyer.phone);
  const totalPaise=Number(invoice.totals.totalPaise??invoice.totals.grossPaise??0);
  const collected=String(invoice.buyer.paymentStatus||'').toLowerCase()==='collected';
  const cashReceivedPaise=collected?totalPaise:0;
  const totalItems=(invoice.items||[]).reduce((sum,item)=>sum+Math.max(0,Number(item.qty)||0),0);
  const wrapText=(text,x,fontSize=8.5,font=regular,color=INK,leading=11)=>{
    const lines=wrap(text,font,fontSize,contentWidth);
    for(const lineText of lines){drawText(page,lineText,x,y,fontSize,font,color);y-=leading;}
  };
  const newPage=(continued=false)=>{
    page=doc.addPage([PAGE_W,PAGE_H]);
    y=PAGE_H-42;
    if(continued){
      drawText(page,invoice.invoiceNumber,MARGIN,y,9,bold,INK);y-=14;
      drawText(page,'Date: '+dateTimeText(dateValue),MARGIN,y,8.5,regular,INK);y-=17;
      separator();
    }else{
      drawText(page,'Hi '+customerName,MARGIN,y,10,bold,INK);y-=19;
      const totalLabel='Total Bill Amount is';
      drawText(page,totalLabel,MARGIN,y,10,bold,INK);
      drawAmountAt(page,totalPaise,MARGIN+bold.widthOfTextAtSize(totalLabel,10)+5,y,10,bold,INK);
      y-=17;
      if(customerPhone){drawText(page,'Customer Phone: '+customerPhone,MARGIN,y,9,regular,INK);y-=17;}
      else y-=2;
      y-=4;
      drawText(page,invoice.invoiceNumber,MARGIN,y,9,bold,INK);y-=14;
      drawText(page,'Date: '+dateTimeText(dateValue),MARGIN,y,9,regular,INK);y-=17;
      separator();
    }
  };
  newPage(false);
  for(const item of (invoice.items||[])){
    const labelLines=wrap(productLabel(item.name,item.unit),regular,9,contentWidth);
    const rowHeight=labelLines.length*11+34;
    if(y-rowHeight<110)newPage(true);
    for(const lineText of labelLines){drawText(page,lineText,MARGIN,y,9,regular,INK);y-=11;}
    drawText(page,'MRP',MARGIN+8,y,8.5,regular,INK);
    drawAmountRight(page,item.unitPricePaise,PAGE_W-MARGIN,y,8.5,regular,INK);
    y-=12;
    drawText(page,'x '+String(item.qty),MARGIN+8,y,8.5,regular,INK);
    drawAmountRight(page,item.grossPaise,PAGE_W-MARGIN,y,8.5,regular,INK);
    y-=19;
  }
  if(y<250)newPage(true);
  drawText(page,'Subtotal',MARGIN,y,9,regular,INK);
  drawAmountRight(page,invoice.totals.grossPaise??totalPaise,PAGE_W-MARGIN,y,9,regular,INK);y-=16;
  separator();
  drawText(page,'TOTAL',MARGIN,y,10,bold,INK);
  drawAmountRight(page,totalPaise,PAGE_W-MARGIN,y,10,bold,INK);y-=17;
  separator();
  drawText(page,'Total Items: '+totalItems,MARGIN,y,9,regular,INK);y-=17;
  separator();
  drawText(page,'Payment Type: Cash',MARGIN,y,9,regular,INK);y-=14;
  drawText(page,'Cash Received:',MARGIN,y,9,regular,INK);
  drawAmountRight(page,cashReceivedPaise,PAGE_W-MARGIN,y,9,regular,INK);y-=14;
  drawText(page,'Change Amount:',MARGIN,y,9,regular,INK);
  drawAmountRight(page,0,PAGE_W-MARGIN,y,9,regular,INK);y-=20;
  const sellerName=invoice.seller.legalName||invoice.seller.storeName||'';
  if(sellerName){wrapText(sellerName,MARGIN,9.5,bold,INK,12);y-=1;}
  if(String(invoice.seller.address||'').trim())wrapText('Address: '+invoice.seller.address,MARGIN,8.5,regular,INK,11);
  if(String(invoice.seller.gstin||'').trim())wrapText('Tax Number: '+invoice.seller.gstin,MARGIN,8.5,regular,INK,11);
  if(String(invoice.seller.phone||'').trim())wrapText('Contact Us: '+invoice.seller.phone,MARGIN,8.5,regular,INK,11);
  if(String(invoice.seller.footer||'').trim()){y-=5;wrapText(invoice.seller.footer,MARGIN,8.5,regular,INK,11);}
  return await doc.save();
}
