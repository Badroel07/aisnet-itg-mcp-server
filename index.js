#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, ".env") });
dotenv.config();

const BASE_URL = process.env.AISNET_URL || "https://api-aisnet.itg.ac.id";
const SESSION_FILE = path.join(os.homedir(), ".aisnet_session.json");

let sessionCache = {
  accessToken: process.env.AISNET_TOKEN || null,
  user: null
};

async function loadSession() {
  if (process.env.AISNET_TOKEN) {
    sessionCache.accessToken = process.env.AISNET_TOKEN;
    return;
  }
  try {
    const raw = await fs.readFile(SESSION_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data.accessToken) {
      sessionCache = data;
    }
  } catch {
    // No saved session
  }
}

async function saveSession(data) {
  sessionCache = data;
  try {
    await fs.writeFile(SESSION_FILE, JSON.stringify(data, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to persist session to disk:", err.message);
  }
}

async function clearSession() {
  sessionCache = { accessToken: null, user: null };
  try {
    await fs.unlink(SESSION_FILE);
  } catch {
    // Ignore error
  }
}

async function performLogin(username, password) {
  try {
    const res = await fetch(`${BASE_URL}/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Origin": "https://aisnet.itg.ac.id",
        "Referer": "https://aisnet.itg.ac.id/"
      },
      body: JSON.stringify({ email: username, password })
    });

    const data = await res.json();
    const token = data.content?.access_token || data.content?.accessToken;

    if (data.status === "success" && token) {
      await saveSession({
        accessToken: token,
        peran: data.content?.peran || "MAHASISWA",
        user: data.content?.user || null
      });
      return { success: true, token, peran: data.content?.peran, message: "Login successful" };
    }

    return {
      success: false,
      message: data.message || "Login failed. Check your NIM/username and password."
    };
  } catch (err) {
    return {
      success: false,
      message: `Network error during login: ${err.message}`
    };
  }
}

async function apiRequest(endpoint, options = {}) {
  await loadSession();

  const envUsername = process.env.AISNET_USERNAME || process.env.AISNET_EMAIL;
  const envPassword = process.env.AISNET_PASSWORD;

  // Auto-login if token is missing and credentials exist in .env
  if (!sessionCache.accessToken && envUsername && envPassword) {
    await performLogin(envUsername, envPassword);
  }

  let token = sessionCache.accessToken;

  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Origin": "https://aisnet.itg.ac.id",
    "Referer": "https://aisnet.itg.ac.id/",
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const cleanEndpoint = endpoint.startsWith("/") ? endpoint.substring(1) : endpoint;
  const url = `${BASE_URL}/${cleanEndpoint}`;

  let res = await fetch(url, {
    ...options,
    headers
  });

  // Handle token expiration: attempt auto-relogin once
  if (res.status === 401 && envUsername && envPassword) {
    const loginRes = await performLogin(envUsername, envPassword);
    if (loginRes.success && sessionCache.accessToken) {
      headers["Authorization"] = `Bearer ${sessionCache.accessToken}`;
      res = await fetch(url, { ...options, headers });
    }
  }

  return res;
}

async function getActiveTahun() {
  try {
    const res = await apiRequest("tahun");
    if (res.ok) {
      const data = await res.json();
      const list = data.data || data.content || data;
      if (Array.isArray(list) && list.length > 0) {
        return list[0].thsms || list[0].tahun || list[0].id || null;
      }
    }
  } catch {
    // Fallback
  }
  return null;
}

const server = new McpServer({
  name: "aisnet-itg",
  version: "1.0.0"
});

// Tool 1: aisnet_login
server.tool(
  "aisnet_login",
  "Authenticate with AISNet ITG using student NIM/NIDN/email and password (optional if defined in .env)",
  {
    username: z.string().optional().describe("AISNet NIM, NIDN, or username. If omitted, reads from .env"),
    password: z.string().optional().describe("AISNet account password. If omitted, reads from .env")
  },
  async ({ username, password }) => {
    const user = username || process.env.AISNET_USERNAME || process.env.AISNET_EMAIL;
    const pass = password || process.env.AISNET_PASSWORD;

    if (!user || !pass) {
      return {
        content: [{ type: "text", text: "Username/NIM dan password harus diisi atau ditentukan di berkas `.env` (AISNET_USERNAME & AISNET_PASSWORD)." }]
      };
    }

    const result = await performLogin(user, pass);
    if (!result.success) {
      return {
        content: [{ type: "text", text: `Gagal login ke AISNet ITG: ${result.message}` }]
      };
    }

    return {
      content: [{
        type: "text",
        text: `### Login Berhasil ke AISNet ITG\n- **Identitas**: ${user}\n- **Peran**: ${result.peran || "MAHASISWA"}\n- **Status Token**: Aktif tersimpan di sesi lokal.\n\nSistem siap digunakan.`
      }]
    };
  }
);

// Tool 2: aisnet_get_profile
server.tool(
  "aisnet_get_profile",
  "Get the authenticated student/lecturer profile and academic status from AISNet ITG",
  {},
  async () => {
    try {
      const res = await apiRequest("user");
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Belum login atau sesi telah kedaluwarsa. Silakan jalankan `aisnet_login` atau pastikan `.env` terisi." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal memuat profil pengguna (HTTP ${res.status}): ${res.statusText}` }]
        };
      }

      const json = await res.json();
      const u = json.data || json.content || json;

      const lines = [
        `### Profil Mahasiswa AISNet ITG`,
        `- **Nama**: ${u.nama || "-"}`,
        `- **NIM**: ${u.nim || "-"}`,
        `- **Program Studi**: ${u.program_studi || u.prodi || u.jurusan || "-"}`,
        `- **Total Beban SKS**: ${u.sks ?? "-"} SKS`,
        `- **Foto Profil**: ${u.foto ? `[Lihat Foto](${u.foto})` : "Tidak ada"}`
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat profil AISNet: ${err.message}` }]
      };
    }
  }
);

// Tool 3: aisnet_get_tahun_akademik
server.tool(
  "aisnet_get_tahun_akademik",
  "List available academic years and semester codes in AISNet ITG",
  {},
  async () => {
    try {
      const res = await apiRequest("tahun");
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Silakan login menggunakan tool `aisnet_login` atau isi kredensial di `.env`." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal mengambil daftar tahun akademik (HTTP ${res.status})` }]
        };
      }

      const json = await res.json();
      const list = json.data || json.content || json;

      if (!Array.isArray(list) || list.length === 0) {
        return {
          content: [{ type: "text", text: "Tidak ada data tahun akademik yang ditemukan." }]
        };
      }

      const lines = [`### Daftar Tahun Akademik AISNet ITG\n`];
      list.forEach((item, idx) => {
        const kode = item.thsms || item.tahun || item.id || "-";
        const nama = item.ket || item.nama_tahun || item.keterangan || kode;
        lines.push(`${idx + 1}. **${nama}** (Kode Semester: \`${kode}\`)`);
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }]
      };
    }
  }
);

// Tool 4: aisnet_get_jadwal_kuliah
server.tool(
  "aisnet_get_jadwal_kuliah",
  "Get active lecture class schedule (mata kuliah, hari, jam, ruang, dosen) in AISNet ITG",
  {
    tahun: z.string().optional().describe("Kode tahun semester (contoh: '20241' atau '20251'). Jika dikosongkan, menggunakan semester aktif otomatis.")
  },
  async ({ tahun }) => {
    try {
      const thsms = tahun || await getActiveTahun();
      if (!thsms) {
        return {
          content: [{ type: "text", text: "Kode tahun semester tidak ditentukan dan gagal memuat semester aktif otomatis. Silakan isi parameter `tahun`." }]
        };
      }

      const res = await apiRequest(`jadwal/kuliah/${thsms}`);
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Sesi tidak valid atau belum login. Gunakan `aisnet_login` atau periksa berkas `.env`." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal memuat jadwal kuliah untuk semester ${thsms} (HTTP ${res.status}).` }]
        };
      }

      const json = await res.json();
      const list = json.data || json.content || json;

      if (!Array.isArray(list) || list.length === 0) {
        return {
          content: [{ type: "text", text: `Tidak ada jadwal perkuliahan terdaftar pada semester ${thsms}.` }]
        };
      }

      const lines = [`### Jadwal Kuliah Semester ${thsms} (${list.length} Mata Kuliah)\n`];
      list.forEach((j, idx) => {
        const matkul = j.nama_matkul || j.nama_mk || j.matakuliah || "Mata Kuliah";
        const kode = j.kode_matkul || j.kdkmk || "-";
        const sks = j.sks || "-";
        const hari = j.hari || "-";
        const jam = j.jam || `${j.jam_mulai || ""}-${j.jam_selesai || ""}` || "-";
        const ruang = j.ruangan || j.ruang || "-";
        const dosen = j.nama_dosen || j.dosen || "-";
        const kelas = j.kelas || "-";

        lines.push(`${idx + 1}. **${matkul}** (Kode: \`${kode}\`, ${sks} SKS, Kelas: ${kelas})`);
        lines.push(`   - **Waktu**: ${hari}, ${jam}`);
        lines.push(`   - **Ruangan**: ${ruang}`);
        lines.push(`   - **Dosen Pengampu**: ${dosen}`);
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat jadwal: ${err.message}` }]
      };
    }
  }
);

// Tool 5: aisnet_get_presensi
server.tool(
  "aisnet_get_presensi",
  "Get lecture attendance records and statistics per enrolled course in AISNet ITG",
  {
    tahun: z.string().optional().describe("Kode tahun semester (contoh: '20241'). Jika kosong, otomatis semester aktif.")
  },
  async ({ tahun }) => {
    try {
      const thsms = tahun || await getActiveTahun();
      if (!thsms) {
        return {
          content: [{ type: "text", text: "Kode semester tidak ditemukan. Silakan isi parameter `tahun`." }]
        };
      }

      const res = await apiRequest(`jadwal/kuliah/${thsms}/absen`);
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Sesi kedaluwarsa atau belum login. Gunakan `aisnet_login`." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal memuat data presensi untuk semester ${thsms} (HTTP ${res.status}).` }]
        };
      }

      const json = await res.json();
      const list = json.data || json.content || json;

      if (!Array.isArray(list) || list.length === 0) {
        return {
          content: [{ type: "text", text: `Tidak ada data rekap presensi pada semester ${thsms}.` }]
        };
      }

      const lines = [`### Rekap Presensi Kuliah Semester ${thsms}\n`];
      list.forEach((item, idx) => {
        const matkul = item.nama_matkul || item.nama_mk || item.matakuliah || `Mata Kuliah ${idx + 1}`;
        const hadir = item.hadir ?? "-";
        const total = item.total_pertemuan ?? item.pertemuan ?? "-";
        const persen = item.persentase ? `${item.persentase}%` : "-";

        lines.push(`${idx + 1}. **${matkul}**`);
        lines.push(`   - **Kehadiran**: ${hadir} / ${total} pertemuan (${persen})`);
        if (item.keterangan) lines.push(`   - **Keterangan**: ${item.keterangan}`);
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat presensi: ${err.message}` }]
      };
    }
  }
);

// Tool 6: aisnet_get_jadwal_ujian
server.tool(
  "aisnet_get_jadwal_ujian",
  "Get examination schedule (UTS or UAS) in AISNet ITG",
  {
    jenis: z.enum(["uts", "uas"]).default("uts").describe("Exam type: 'uts' (Ujian Tengah Semester) or 'uas' (Ujian Akhir Semester)"),
    tahun: z.string().optional().describe("Kode tahun semester (contoh: '20241'). Jika kosong, otomatis semester aktif.")
  },
  async ({ jenis, tahun }) => {
    try {
      const thsms = tahun || await getActiveTahun();
      if (!thsms) {
        return {
          content: [{ type: "text", text: "Kode semester tidak ditemukan. Silakan isi parameter `tahun`." }]
        };
      }

      const res = await apiRequest(`jadwal/${jenis}/${thsms}`);
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Sesi tidak valid. Jalankan `aisnet_login` atau periksa `.env`." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal memuat jadwal ${jenis.toUpperCase()} semester ${thsms} (HTTP ${res.status}).` }]
        };
      }

      const json = await res.json();
      const list = json.data || json.content || json;

      if (!Array.isArray(list) || list.length === 0) {
        return {
          content: [{ type: "text", text: `Tidak ada jadwal ${jenis.toUpperCase()} yang terdaftar pada semester ${thsms}.` }]
        };
      }

      const lines = [`### Jadwal ${jenis.toUpperCase()} Semester ${thsms} (${list.length} Ujian)\n`];
      list.forEach((u, idx) => {
        const matkul = u.nama_matkul || u.nama_mk || u.matakuliah || "Ujian";
        const tanggal = u.tanggal || u.hari || "-";
        const jam = u.jam || `${u.jam_mulai || ""}-${u.jam_selesai || ""}` || "-";
        const ruang = u.ruangan || u.ruang || "-";
        const kursi = u.kursi || u.no_kursi || "-";

        lines.push(`${idx + 1}. **${matkul}**`);
        lines.push(`   - **Jadwal**: ${tanggal}, Jam ${jam}`);
        lines.push(`   - **Ruangan & Kursi**: Ruang ${ruang} | No Kursi: ${kursi}`);
        lines.push("");
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat jadwal ujian: ${err.message}` }]
      };
    }
  }
);

// Tool 7: aisnet_get_khs
server.tool(
  "aisnet_get_khs",
  "Get student grades and Kartu Hasil Studi (KHS) for a semester in AISNet ITG",
  {
    tahun: z.string().optional().describe("Kode tahun semester (contoh: '20241'). Jika kosong, otomatis semester aktif.")
  },
  async ({ tahun }) => {
    try {
      const thsms = tahun || await getActiveTahun();
      if (!thsms) {
        return {
          content: [{ type: "text", text: "Kode semester tidak ditemukan. Silakan isi parameter `tahun`." }]
        };
      }

      const res = await apiRequest(`nilai/${thsms}`);
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Belum login atau sesi telah kedaluwarsa. Gunakan `aisnet_login`." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal memuat nilai KHS semester ${thsms} (HTTP ${res.status}).` }]
        };
      }

      const json = await res.json();
      const payload = json.data || json.content || json;
      const list = Array.isArray(payload) ? payload : (payload.nilai || payload.mata_kuliah || []);

      if (list.length === 0) {
        return {
          content: [{ type: "text", text: `Tidak ada data nilai / KHS tercatat pada semester ${thsms}.` }]
        };
      }

      const lines = [`### Kartu Hasil Studi (KHS) Semester ${thsms}\n`];
      list.forEach((n, idx) => {
        const matkul = n.nama_matkul || n.nama_mk || n.matakuliah || "Mata Kuliah";
        const sks = n.sks || "-";
        const huruf = n.nilai_huruf || n.grade || n.nilai || "-";
        const angka = n.nilai_angka || n.bobot || "-";

        lines.push(`${idx + 1}. **${matkul}** (${sks} SKS)`);
        lines.push(`   - **Nilai Akhir**: **${huruf}** (Bobot: ${angka})`);
        lines.push("");
      });

      if (payload.ips) lines.push(`- **Indeks Prestasi Semester (IPS)**: ${payload.ips}`);
      if (payload.ipk) lines.push(`- **Indeks Prestasi Kumulatif (IPK)**: ${payload.ipk}`);
      if (payload.total_sks) lines.push(`- **Total SKS Diambil**: ${payload.total_sks}`);

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat KHS: ${err.message}` }]
      };
    }
  }
);

// Tool 8: aisnet_get_keuangan
server.tool(
  "aisnet_get_keuangan",
  "Get financial tuition fees, billing status, and payment breakdown in AISNet ITG",
  {
    tahun: z.string().optional().describe("Kode tahun semester (contoh: '20241'). Jika kosong, otomatis semester aktif.")
  },
  async ({ tahun }) => {
    try {
      const thsms = tahun || await getActiveTahun();
      if (!thsms) {
        return {
          content: [{ type: "text", text: "Kode semester tidak ditemukan. Silakan isi parameter `tahun`." }]
        };
      }

      const [resSummary, resDetail] = await Promise.all([
        apiRequest(`pembayaran/${thsms}`),
        apiRequest(`pembayaran/${thsms}/rincian`)
      ]);

      if (resSummary.status === 401) {
        return {
          content: [{ type: "text", text: "Sesi tidak valid. Gunakan `aisnet_login` atau periksa berkas `.env`." }]
        };
      }

      const summaryData = resSummary.ok ? await resSummary.json() : null;
      const detailData = resDetail.ok ? await resDetail.json() : null;

      const sum = summaryData?.data || summaryData?.content || summaryData || {};
      const items = Array.isArray(detailData?.data) ? detailData.data : Array.isArray(detailData?.content) ? detailData.content : [];

      const lines = [
        `### Status Keuangan Semester ${thsms}`,
        `- **Status Pembayaran**: ${sum.status_keuangan === 0 ? "Lunas" : sum.status_keuangan ? `Belum Lunas (Sisa: Rp ${Number(sum.status_keuangan).toLocaleString("id-ID")})` : "Lunas / Tidak Ada Tagihan"}`,
        `- **Total Tagihan**: ${sum.total_tagihan ? `Rp ${Number(sum.total_tagihan).toLocaleString("id-ID")}` : "-"}`,
        `- **Total Terbayar**: ${sum.total_bayar ? `Rp ${Number(sum.total_bayar).toLocaleString("id-ID")}` : "-"}`
      ];

      if (items.length > 0) {
        lines.push(`\n#### Rincian Pos Pembayaran:\n`);
        items.forEach((it, idx) => {
          const pos = it.nama_pos || it.pos_keuangan || it.keterangan || `Pos ${idx + 1}`;
          const nominal = it.nominal ? `Rp ${Number(it.nominal).toLocaleString("id-ID")}` : "-";
          const status = it.status === 1 || it.is_lunas ? "Lunas" : "Belum Lunas";
          lines.push(`${idx + 1}. **${pos}**: ${nominal} (${status})`);
        });
      }

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat keuangan: ${err.message}` }]
      };
    }
  }
);

// Tool 9: aisnet_get_status_studi
server.tool(
  "aisnet_get_status_studi",
  "Get student academic status and remaining study duration from AISNet ITG",
  {},
  async () => {
    try {
      const res = await apiRequest("masa-studi/mahasiswa/sisa-studi");
      if (res.status === 401) {
        return {
          content: [{ type: "text", text: "Silakan login menggunakan `aisnet_login` atau periksa `.env`." }]
        };
      }

      if (!res.ok) {
        return {
          content: [{ type: "text", text: `Gagal memuat status masa studi (HTTP ${res.status}).` }]
        };
      }

      const json = await res.json();
      const s = json.data || json.content || json;

      const lines = [
        `### Status Masa Studi Mahasiswa`,
        `- **Sisa Masa Studi**: ${s.sisa_studi || s.sisa_semester || "-"} semester`,
        `- **Batas Masa Studi**: Semester ${s.batas_studi || s.tahun_batas || "-"}`,
        `- **Status Akademik**: ${s.status_akademik || s.status || "Aktif"}`,
        `- **Keterangan**: ${s.keterangan || "Tidak ada peringatan akademik."}`
      ];

      return {
        content: [{ type: "text", text: lines.join("\n") }]
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error memuat status studi: ${err.message}` }]
      };
    }
  }
);

// Tool 10: aisnet_logout
server.tool(
  "aisnet_logout",
  "Clear AISNet ITG active authentication session and local token",
  {},
  async () => {
    await clearSession();
    return {
      content: [{ type: "text", text: "Sesi login AISNet ITG berhasil dihapus." }]
    };
  }
);

async function main() {
  await loadSession();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("AISNet ITG MCP Server failed:", err);
  process.exit(1);
});
