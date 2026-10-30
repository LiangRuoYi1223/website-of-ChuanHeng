# home-summit image source

- Created: 2026-10-30.
- Tool: built-in `image_gen.imagegen`. New photo generation from new design references, followed by one targeted person-scale edit.
- Visual references (viewed before generation):
  - `C:\Users\ander\Desktop\徒步新设计\e57f2b60-f9ce-456d-ad4f-26f172119ed8.png`.
  - `C:\Users\ander\Desktop\徒步新设计\8e32bf8a-bfaa-43c0-a4df-dda3c15b6761.png`.
- The upper-left home-page hero photos were used as visual/content guidance; no website UI was reproduced and no old project photo was reused.
- First generated file: `C:\Users\ander\.codex\generated_images\01a18cf3-270d-7920-bb4e-e8137651b9f8\exec-8ab013f9-6cd4-49e5-b161-f00123b391bd.png`.
- Final generated file: `C:\Users\ander\.codex\generated_images\01a18cf3-270d-7920-bb4e-e8137651b9f8\exec-8c5b8d59-8ffa-4adb-9f2c-2c03b6ea797d.png`.
- Preserved final PNG: `artifacts/redesign-v2/home-summit.png`.
- Web asset: `public/images/redesign-v2/home-summit.webp`. Pillow format conversion/compression only, quality 89, method 6; no cropping or resizing.
- This is AI-generated illustrative imagery, not an actual 川衡 association activity photograph or a verified geographic location.
- Visual QA: dominant layered sharp snow peaks, cool blue left valleys, restrained right-side sunset light and narrow sky band, small dark backpacker on the broad right-side ridge, no UI/text/logo.

## Initial generation prompt

```text
Use case: photorealistic-natural
Asset type: clean wide home-page hero photograph, horizontal 16:9
Input images: Image 1 and Image 2 are visual-reference website design contact sheets. Redraw the photographic content of the UPPER-LEFT home-page hero from these references as one NEW standalone photograph. The reference's dramatic layered blue snowy mountains, restrained warm light and compact hiker are the stylistic target. Do not reproduce either contact sheet or any UI.
Primary request: A vast layered alpine mountain panorama dominated by sharp blue and white snowy peaks, with one SMALL dark-clothed backpacking hiker facing away at the right, above deep cool blue mountain valleys and cloud-filled hollows.
Composition/framing: Epic professional mountaineering photograph. The dominant pointed snowy summit is just RIGHT of center, approximately 60 percent across, and its peak reaches the upper 20 percent of the frame. Mountain mass, shadow valleys, snowy ridges and foreground occupy 75 to 80 percent of the total image. Sky is ONLY a narrow top band around 20 to 25 percent high; do NOT allocate a large orange sky. Many layers of jagged mountains create compelling depth. The LEFT HALF is naturally dark cool blue mountain valley with quieter detail and controlled highlights, leaving visual room for a large white website headline to be overlaid later; no actual lettering.
Subject: One small yet clearly visible adult backpacker viewed from behind at approximately 80 percent across the image. The hiker's full body is about 25 percent of the image height, not a giant foreground person. Clothing is dark charcoal/slate, unbranded jacket and modest realistic backpack, no orange jacket and no bright clothing. The hiker stands calmly on a broad safe rocky ridge well away from any exposed cliff edge.
Lighting/mood: Low evening sun glows softly from near the far RIGHT edge, partially concealed beyond distant peaks, gently touching upper snowy edges with pale gold. A restrained thin pale peach/pink and amber horizon fades into cool gray-blue upper sky. The whole scene is predominantly cold blue and white, not orange. No giant sun disc, overwhelming flare or uniformly orange mountain faces.
Style/medium: Refined realistic international mountain expedition photography, natural snow structure and layered atmospheric depth, crisp authentic rock detail, believable human anatomy and lighting. Grand scale, calm adventurous mood.
Color palette: Deep cool navy valleys, blue-gray rock, clean white snow, sparse pale golden highlights, understated pink/amber sky. Natural photographic dynamic range and colors, no excessive teal/orange grade.
Constraints: Only the clean photograph, no text, logo, watermark, border, buttons, UI, collage, or map. No other people, no structures or tents. No prominent orange clothing. Newly AI-created illustrative photography, not a real Chuanheng association activity photograph or a verified named location.
```

## Targeted edit prompt

```text
Use case: precise-object-edit
Edit target: the generated wide snowy mountain photograph.
Change ONLY the size and position of the lone rear-facing dark backpacker. Make the person visibly smaller: total head-to-boots height must be approximately ONE QUARTER (25 percent) of the full image height, with the head near 47 percent down the image and boots near 72 percent down. Place the person's center at 80 percent across from the left, still standing naturally on the broad safe rocky ridge. Keep dark charcoal clothing and a realistic modest backpack, back to camera, no visible face, no orange clothing.
Preserve the mountain panorama, every major peak, the sky, cloud layers, colors, photographic detail, and overall composition unchanged. Extend/fill only the small rock/background area revealed around the resized person in a seamless natural way. Do not add anyone else.
Output the same clean 16:9 photograph. No UI, writing, logo, watermark or collage.
```

