// Node-only development adapter. Import dynamically from the Vite adapter;
// this file must never be imported by the production Worker or shared pipeline.
export async function createLocalImageBinding() {
  const { default: sharp } = await import('sharp');
  const read = async stream => new Uint8Array(await new Response(stream).arrayBuffer());
  return {
    async info(stream) {
      const bytes=await read(stream);
      const metadata=await sharp(bytes,{limitInputPixels:40_000_000}).metadata();
      return {format:`image/${metadata.format}`,fileSize:bytes.byteLength,width:metadata.width,height:metadata.height};
    },
    input(stream) {
      let dimensions;
      return {
        transform(options) {dimensions=options;return this;},
        async output(options) {
          if(options.format!=='image/webp'||options.anim!==false) throw new Error('Unsupported local cover output');
          const bytes=await read(stream);
          // Sharp removes metadata unless explicitly asked to retain it.
          const output=await sharp(bytes,{limitInputPixels:40_000_000,animated:false}).rotate().resize({width:dimensions?.width,height:dimensions?.height,fit:'inside',withoutEnlargement:true}).webp({quality:options.quality}).toBuffer();
          return {response:()=>new Response(output,{headers:{'content-type':'image/webp'}})};
        },
      };
    },
  };
}
