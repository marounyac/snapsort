// SnapSort — category taxonomy.
// 5 main categories, each with 5 mini-categories. Every mini-category has
// CLIP text prompts; the AI matches each photo against ALL prompts and files
// the photo under the best-matching mini-category.
(() => {
  const MAINS = [
    {
      id: 'nature', name: 'Nature', emoji: '🌿', color: '#34d399',
      minis: [
        { id: 'landscapes', name: 'Landscapes & Mountains', emoji: '🏔️', prompts: [
          'a photo of a mountain landscape',
          'a scenic photo of hills, valleys or a forest',
        ]},
        { id: 'beach', name: 'Beach & Sea', emoji: '🌊', prompts: [
          'a photo of the beach and the sea',
          'a photo of ocean waves or a lake shore',
        ]},
        { id: 'plants', name: 'Plants & Flowers', emoji: '🌸', prompts: [
          'a close-up photo of flowers',
          'a photo of plants, trees or greenery',
        ]},
        { id: 'wildlife', name: 'Wild Animals & Birds', emoji: '🦅', prompts: [
          'a photo of a wild animal in nature',
          'a photo of a bird or an insect outdoors',
        ]},
        { id: 'sky', name: 'Sky & Sunsets', emoji: '🌅', prompts: [
          'a photo of a sunset or sunrise sky',
          'a photo of clouds, the moon or the night sky',
        ]},
      ],
    },
    {
      id: 'people', name: 'Friends, Events & Family', emoji: '🎉', color: '#f472b6',
      minis: [
        { id: 'selfies', name: 'Selfies & Portraits', emoji: '🤳', prompts: [
          'a selfie of a person',
          'a portrait photo of a person\'s face',
        ]},
        { id: 'groups', name: 'Group Photos', emoji: '👥', prompts: [
          'a group photo of friends posing together',
          'a photo of a group of people smiling at the camera',
        ]},
        { id: 'parties', name: 'Parties & Celebrations', emoji: '🎂', prompts: [
          'a photo of a birthday party with cake, candles or balloons',
          'a photo of a party or celebration with decorations',
        ]},
        { id: 'weddings', name: 'Weddings & Ceremonies', emoji: '💍', prompts: [
          'a photo of a wedding or an engagement ceremony',
          'a photo of people in formal clothes at a ceremony',
        ]},
        { id: 'family', name: 'Family Moments', emoji: '👨‍👩‍👧', prompts: [
          'a warm family photo with parents, children or relatives',
          'a photo of a baby or a child with family',
        ]},
      ],
    },
    {
      id: 'study', name: 'Study / School & Homework', emoji: '📚', color: '#60a5fa',
      minis: [
        { id: 'maths', name: 'Maths', emoji: '➗', prompts: [
          'a photo of math homework with equations and calculations',
          'a page of mathematics exercises with numbers and formulas',
        ]},
        { id: 'languages', name: 'Languages', emoji: '🔤', prompts: [
          'a photo of language learning notes with vocabulary words',
          'a page of grammar exercises or foreign language text',
        ]},
        { id: 'science', name: 'Science', emoji: '🔬', prompts: [
          'a photo of science study material with diagrams of biology, chemistry or physics',
          'a page of science notes with a lab experiment or scientific diagram',
        ]},
        { id: 'coding', name: 'Coding / Computer Science', emoji: '💻', prompts: [
          'a computer screen showing programming code',
          'a photo of source code in a code editor or terminal',
        ]},
      ],
    },
    {
      id: 'food', name: 'Food & Drinks', emoji: '🍔', color: '#fbbf24',
      minis: [
        { id: 'meals', name: 'Meals & Dishes', emoji: '🍽️', prompts: [
          'a photo of a plate of cooked food',
          'a photo of a homemade meal on a table',
        ]},
        { id: 'desserts', name: 'Desserts & Sweets', emoji: '🍰', prompts: [
          'a photo of a cake, dessert or pastry',
          'a photo of chocolate, candy or sweets',
        ]},
        { id: 'drinks', name: 'Drinks & Coffee', emoji: '☕', prompts: [
          'a photo of a cup of coffee or tea',
          'a photo of a drink, juice or cocktail in a glass',
        ]},
        { id: 'fastfood', name: 'Fast Food & Snacks', emoji: '🍕', prompts: [
          'a photo of fast food like pizza, burgers or fries',
          'a photo of chips or packaged snacks',
        ]},
        { id: 'fruits', name: 'Fruits & Vegetables', emoji: '🍎', prompts: [
          'a photo of fresh fruit',
          'a photo of vegetables in a kitchen or market',
        ]},
      ],
    },
    {
      id: 'daily', name: 'Daily Life & Home', emoji: '🏠', color: '#a78bfa',
      minis: [
        { id: 'rooms', name: 'Home & Rooms', emoji: '🛋️', prompts: [
          'a photo of a room inside a home with furniture',
          'a photo of a house interior, bedroom or living room',
        ]},
        { id: 'pets', name: 'Pets', emoji: '🐾', prompts: [
          'a photo of a pet dog or cat at home',
          'a cute photo of a domestic pet',
        ]},
        { id: 'city', name: 'City & Streets', emoji: '🏙️', prompts: [
          'a photo of a city street with buildings',
          'a photo of shops, roads or urban scenery',
        ]},
        { id: 'transport', name: 'Cars & Transport', emoji: '🚗', prompts: [
          'a photo of a car, motorcycle or bicycle',
          'a photo of a bus, train or airplane',
        ]},
        { id: 'objects', name: 'Shopping & Objects', emoji: '🛍️', prompts: [
          'a photo of clothes, shoes or accessories',
          'a photo of everyday objects or products',
        ]},
      ],
    },
  ];

  // Every main category gets an "Other" mini-category as its LAST option
  // (skipped if a list already defines one). "Other" has no prompts: the AI
  // never auto-picks it — it exists for manual moves and as a safe fallback.
  for (const m of MAINS) {
    if (!m.minis.some((mini) => mini.name.toLowerCase() === 'other')) {
      m.minis.push({
        id: m.id + '_other', name: 'Other', emoji: '🗂️',
        hint: 'Doesn’t fit any of the above', prompts: [],
      });
    }
  }

  // Mini-categories that were removed; photos saved under them are migrated
  // at startup (see boot() in app.js).
  const LEGACY = {
    notes: 'study_other',
    books: 'study_other',
    documents: 'study_other',
    boards: 'study_other',
    screens: 'study_other',
  };

  const byMini = {};
  const mainById = {};
  for (const m of MAINS) {
    mainById[m.id] = m;
    for (const mini of m.minis) {
      byMini[mini.id] = Object.assign({}, mini, { mainId: m.id });
    }
  }

  window.CATS = {
    version: 'v2', // bump when prompts change so cached label embeddings recompute
    mains: MAINS,
    byMini,
    mainById,
    miniOrder: Object.keys(byMini),
    // Only minis with prompts participate in AI matching.
    aiMiniIds: Object.keys(byMini).filter((id) => byMini[id].prompts.length > 0),
    legacy: LEGACY,
  };
})();
