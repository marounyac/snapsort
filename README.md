# 📸 SnapSort — AI Photo Organizer

A website that sorts your photos into categories automatically using AI — running **entirely in your browser**. No account, no server, no API keys. Your photos never leave your device.

## How to open it

Just **double-click `index.html`** (use Chrome or Edge). That's it — no installation needed.

To use it on your **phone**, the site needs to be hosted online (for example with GitHub Pages, like the church website). Once hosted, open the link on your phone and use "Add to Home Screen" to make it feel like a real app.

## How it works

1. Tap **＋ Import** and pick pictures from your gallery (you can select many at once), or tap **📷** to take a photo with your camera.
2. Choose **"Choose category myself"** or **"Let AI choose"**. With AI, each photo is filed into the best-matching category automatically (use **📂 Move** if it gets one wrong). If the AI can't load, you just pick the category yourself.
3. Browse by category, or see everything in **All Photos**.
4. Tap any photo to view it fullscreen — pinch or double-tap to **zoom**, swipe to move between photos, swipe down to close.
5. Use **✏️ Edit** to crop, rotate, flip, and adjust brightness / contrast / saturation. You can always restore the original.
6. If the AI ever picks the wrong spot, use **📂 Move** to place the photo yourself.
7. **⬇️ Download all photos** (on the home screen) saves everything as one `.zip`, organised into `Category/Sub-category` folders — built on your device, so photos still never leave it.

> **First import only:** the AI model (~150 MB) is downloaded once and then stored on your device — Wi-Fi recommended. After that it loads instantly, even offline (when hosted).

## Categories

| Main category | Mini-categories |
|---|---|
| 🌿 Nature | Landscapes & Mountains · Beach & Sea · Plants & Flowers · Wild Animals & Birds · Sky & Sunsets · Other |
| 🎉 Friends, Events & Family | Selfies & Portraits · Group Photos · Parties & Celebrations · Weddings & Ceremonies · Family Moments · Other |
| 📚 Study / School & Homework | Maths · Languages · Science · Coding / Computer Science · Other |
| 🍔 Food & Drinks | Meals & Dishes · Desserts & Sweets · Drinks & Coffee · Fast Food & Snacks · Fruits & Vegetables · Other |
| 🏠 Daily Life & Home | Home & Rooms · Pets · City & Streets · Cars & Transport · Shopping & Objects · Other |

Every category ends with an **Other** bucket. The AI never picks "Other" on its own — it's there for you to move photos into, and it's where photos land if the AI can't process them.

### Your own categories

Tap **🗂️ Manage categories** on the home screen to create your own:

- Give a category a **name** and (optionally) a short description of **what belongs here** — the description helps the AI sort more accurately.
- Add **sub-categories** one at a time, each with its own optional description. **Other** is added automatically as the last sub-category (you can't remove it).
- **Rename** or **delete** anything you created; built-in categories stay as they are. Deleting a category never deletes photos — they move to **Uncategorised** (or to the category's **Other** when you delete just a sub-category), and you can re-file them with **Move**.
- The AI immediately starts sorting into your categories: on the next AI import it re-learns the current list, names and descriptions included.

## Tech

- Plain HTML / CSS / JavaScript — no build step.
- AI: [OpenAI CLIP](https://huggingface.co/Xenova/clip-vit-base-patch32) running in the browser via [transformers.js](https://github.com/xenova/transformers.js).
- Photos, thumbnails, and the AI model are stored locally in IndexedDB.
- Works as a PWA (installable, offline) when hosted over HTTPS.

## Troubleshooting

- **"AI model couldn't load"** — check your internet connection and tap Retry. The download is only needed once.
- **A photo won't import** — some formats (like Windows `.heic` files) can't be read by browsers. On iPhone this is handled automatically.
- **Sorting is slow** — the first photo takes the longest; after that it speeds up. Sorting happens on your device, so a newer device = faster sorting.
