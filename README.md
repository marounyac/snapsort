# 📸 SnapSort — AI Photo Organizer

A website that sorts your photos into categories automatically using AI — running **entirely in your browser**. No account, no server, no API keys. Your photos never leave your device.

## How to open it

Just **double-click `index.html`** (use Chrome or Edge). That's it — no installation needed.

To use it on your **phone**, the site needs to be hosted online (for example with GitHub Pages, like the church website). Once hosted, open the link on your phone and use "Add to Home Screen" to make it feel like a real app.

## How it works

1. Tap **＋ Import** and pick pictures from your gallery (you can select many at once), or tap **📷** to take a photo with your camera and have it sorted right away.
2. The AI looks at each photo and files it into the right category and mini-category.
3. Browse by category, or see everything in **All Photos**.
4. Tap any photo to view it fullscreen — pinch or double-tap to **zoom**, swipe to move between photos, swipe down to close.
5. Use **✏️ Edit** to crop, rotate, flip, and adjust brightness / contrast / saturation. You can always restore the original.
6. If the AI ever picks the wrong spot, use **📂 Move** to place the photo yourself.

> **First import only:** the AI model (~150 MB) is downloaded once and then stored on your device — Wi-Fi recommended. After that it loads instantly, even offline (when hosted).

## Categories

| Main category | Mini-categories |
|---|---|
| 🌿 Nature | Landscapes & Mountains · Beach & Sea · Plants & Flowers · Wild Animals & Birds · Sky & Sunsets |
| 🎉 Friends, Events & Family | Selfies & Portraits · Group Photos · Parties & Celebrations · Weddings & Ceremonies · Family Moments |
| 📚 Study / School & Homework | Handwritten Notes · Books & Textbooks · Documents & Printouts · Whiteboards & Blackboards · Screens & Slides |
| 🍔 Food & Drinks | Meals & Dishes · Desserts & Sweets · Drinks & Coffee · Fast Food & Snacks · Fruits & Vegetables |
| 🏠 Daily Life & Home | Home & Rooms · Pets · City & Streets · Cars & Transport · Shopping & Objects |

Want different mini-categories? Edit `js/categories.js` — each one is just a name plus a couple of English sentences describing what belongs in it.

## Tech

- Plain HTML / CSS / JavaScript — no build step.
- AI: [OpenAI CLIP](https://huggingface.co/Xenova/clip-vit-base-patch32) running in the browser via [transformers.js](https://github.com/xenova/transformers.js).
- Photos, thumbnails, and the AI model are stored locally in IndexedDB.
- Works as a PWA (installable, offline) when hosted over HTTPS.

## Troubleshooting

- **"AI model couldn't load"** — check your internet connection and tap Retry. The download is only needed once.
- **A photo won't import** — some formats (like Windows `.heic` files) can't be read by browsers. On iPhone this is handled automatically.
- **Sorting is slow** — the first photo takes the longest; after that it speeds up. Sorting happens on your device, so a newer device = faster sorting.
