// SnapSort — ZIP export, built fully in the browser so photos never leave
// the device. Entries are stored uncompressed (photos are already JPEG/PNG
// compressed) and the final Blob *references* the photo blobs instead of
// copying them, so memory stays flat even for a large library.
(() => {
  // ---------- CRC-32 ----------
  const TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  async function crc32OfBlob(blob) {
    let crc = 0xffffffff;
    const CHUNK = 4 * 1024 * 1024; // read big files piecewise
    for (let off = 0; off < blob.size; off += CHUNK) {
      const buf = new Uint8Array(await blob.slice(off, off + CHUNK).arrayBuffer());
      for (let i = 0; i < buf.length; i++) crc = TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ---------- ZIP records ----------
  const enc = new TextEncoder();

  function dosDateTime(ms) {
    const d = new Date(ms || Date.now());
    if (d.getFullYear() < 1980) return { date: 0x21, time: 0 };
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  }

  function localHeader(nameBytes, crc, size, dt) {
    const v = new DataView(new ArrayBuffer(30));
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);      // version needed to extract
    v.setUint16(6, 0x0800, true);  // flags: UTF-8 filenames
    v.setUint16(8, 0, true);       // method: store
    v.setUint16(10, dt.time, true);
    v.setUint16(12, dt.date, true);
    v.setUint32(14, crc, true);
    v.setUint32(18, size, true);   // compressed = uncompressed (store)
    v.setUint32(22, size, true);
    v.setUint16(26, nameBytes.length, true);
    v.setUint16(28, 0, true);      // extra field length
    return new Uint8Array(v.buffer);
  }

  function centralHeader(nameBytes, crc, size, dt, offset) {
    const v = new DataView(new ArrayBuffer(46));
    v.setUint32(0, 0x02014b50, true);
    v.setUint16(4, 20, true);      // version made by
    v.setUint16(6, 20, true);      // version needed
    v.setUint16(8, 0x0800, true);
    v.setUint16(10, 0, true);
    v.setUint16(12, dt.time, true);
    v.setUint16(14, dt.date, true);
    v.setUint32(16, crc, true);
    v.setUint32(20, size, true);
    v.setUint32(24, size, true);
    v.setUint16(28, nameBytes.length, true);
    // extra/comment/disk/attrs stay zero
    v.setUint32(42, offset, true);
    return new Uint8Array(v.buffer);
  }

  function endRecord(count, cdSize, cdOffset) {
    const v = new DataView(new ArrayBuffer(22));
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, count, true);
    v.setUint16(10, count, true);
    v.setUint32(12, cdSize, true);
    v.setUint32(16, cdOffset, true);
    return new Uint8Array(v.buffer);
  }

  // ---------- naming ----------
  function sanitizeName(name) {
    return String(name)
      .replace(/\s*[\/\\:*?"<>|]+\s*/g, ' - ')
      .replace(/[\x00-\x1f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/, '') || 'Folder';
  }

  function splitExt(name) {
    const m = /^(.+?)(\.[A-Za-z0-9]+)$/.exec(name);
    return m ? [m[1], m[2]] : [name, ''];
  }

  window.Exporter = {
    // Turns photo records into zip entries: Category/Sub-category folders
    // (sanitised for the filesystem), "Uncategorised" for unsorted photos,
    // original filenames with " (1)", " (2)"… on duplicates within a folder.
    plan(records) {
      const used = new Set(); // lowercased full paths
      const entries = [];
      for (const rec of records) {
        let folder;
        if (rec.miniCat && CATS.byMini[rec.miniCat]) {
          const mini = CATS.byMini[rec.miniCat];
          const main = CATS.mainById[mini.mainId];
          folder = sanitizeName(main.name) + '/' + sanitizeName(mini.name);
        } else {
          folder = 'Uncategorised';
        }
        let fname = String(rec.name || 'photo').replace(/[\/\\:*?"<>|\x00-\x1f]+/g, '-').trim() || 'photo';
        const parts = splitExt(fname);
        let candidate = fname;
        for (let n = 1; used.has((folder + '/' + candidate).toLowerCase()); n++) {
          candidate = parts[0] + ' (' + n + ')' + parts[1];
        }
        used.add((folder + '/' + candidate).toLowerCase());
        entries.push({
          path: 'snapsort-export/' + folder + '/' + candidate,
          blob: rec.blob,
          addedAt: rec.addedAt,
        });
      }
      return entries;
    },

    // Assembles the zip one file at a time. onProgress(done, total) after each
    // file; shouldStop() is checked between files — returns null when stopped.
    // Throws if the archive would exceed the classic ZIP limits.
    async build(entries, onProgress, shouldStop) {
      if (entries.length > 65000) throw new Error('Too many photos for one ZIP (max 65,000).');
      const parts = [];
      const central = [];
      let offset = 0;
      for (let i = 0; i < entries.length; i++) {
        if (shouldStop && shouldStop()) return null;
        const e = entries[i];
        const nameBytes = enc.encode(e.path);
        const dt = dosDateTime(e.addedAt);
        const crc = await crc32OfBlob(e.blob);
        if (shouldStop && shouldStop()) return null;
        const lh = localHeader(nameBytes, crc, e.blob.size, dt);
        central.push(centralHeader(nameBytes, crc, e.blob.size, dt, offset), nameBytes);
        parts.push(lh, nameBytes, e.blob);
        offset += lh.length + nameBytes.length + e.blob.size;
        if (offset > 4294000000) throw new Error('Export is larger than the 4 GB ZIP limit.');
        if (onProgress) onProgress(i + 1, entries.length);
      }
      let cdSize = 0;
      for (const c of central) { parts.push(c); cdSize += c.length; }
      parts.push(endRecord(entries.length, cdSize, offset));
      return new Blob(parts, { type: 'application/zip' });
    },
  };
})();
