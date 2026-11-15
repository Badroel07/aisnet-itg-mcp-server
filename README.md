# AISNet ITG MCP Server

MCP (Model Context Protocol) Server resmi untuk integrasi dengan portal SIAKAD **AISnet Institut Teknologi Garut** ([https://aisnet.itg.ac.id/](https://aisnet.itg.ac.id/)).

Server ini berkomunikasi langsung dengan backend REST API AISNet (`https://api-aisnet.itg.ac.id/`) secara efisien, terstruktur, dan otomatis mengelola autentikasi berbasis file `.env`.

---

## Konfigurasi Kredensial (.env)

Server ini menggunakan sistem konfigurasi persis seperti `elearning-itg-mcp`. Buat atau edit berkas `.env` di dalam folder proyek:

```env
AISNET_URL=https://api-aisnet.itg.ac.id
AISNET_USERNAME=2306158
AISNET_PASSWORD=your_password_here
```

Jika `AISNET_USERNAME` dan `AISNET_PASSWORD` terisi pada `.env`, seluruh pemanggilan tool (`aisnet_get_profile`, `aisnet_get_jadwal_kuliah`, `aisnet_get_khs`, dll.) akan melakukan login otomatis tanpa perlu memanggil `aisnet_login` secara manual.

---

## Konfigurasi Antigravity (`mcp_config.json`)

```json
{
  "mcpServers": {
    "aisnet-itg": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/Users/muham/.gemini/antigravity/scratch/aisnet-itg-mcp/index.js"
      ],
      "env": {
        "AISNET_URL": "https://api-aisnet.itg.ac.id"
      }
    }
  }
}
```

---

## Daftar Tools yang Tersedia

1. **`aisnet_get_profile`**: Mengambil identitas diri, program studi, beban SKS, dan foto profil.
2. **`aisnet_get_jadwal_kuliah`**: Mengambil jadwal kuliah (mata kuliah, hari, jam, ruang, kelas, dan dosen pengampu).
3. **`aisnet_get_tahun_akademik`**: Menampilkan daftar tahun ajaran dan kode semester.
4. **`aisnet_get_presensi`**: Menampilkan rekap kehadiran perkuliahan per mata kuliah.
5. **`aisnet_get_jadwal_ujian`**: Mengambil jadwal ujian UTS atau UAS.
6. **`aisnet_get_khs`**: Mengambil nilai KHS semester dan IPK/IPS.
7. **`aisnet_get_keuangan`**: Mengecek status pembayaran UKT/SPP dan rincian pos tagihan.
8. **`aisnet_get_status_studi`**: Memeriksa sisa semester dan batas masa studi.
9. **`aisnet_login`**: Opsi login manual jika kredensial `.env` ingin diganti dinamis.
10. **`aisnet_logout`**: Menghapus sesi aktif dari perangkat lokal.
