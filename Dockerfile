# Menggunakan Node.js 18 sebagai base image
FROM node:18-alpine

# Instal FFmpeg di dalam container
# Alpine menggunakan 'apk' sebagai package manager
RUN apk add --no-cache ffmpeg

# Buat direktori kerja
WORKDIR /app

# Salin package.json dan package-lock.json (jika ada)
COPY package.json ./
# Instal dependensi Node.js
RUN npm install

# Salin seluruh kode aplikasi ke direktori kerja
COPY . .

# Buat direktori untuk penyimpanan video yang diunggah
RUN mkdir -p /app/uploads

# Expose port yang digunakan oleh aplikasi Node.js
EXPOSE 3000

# Perintah untuk menjalankan aplikasi ketika container dimulai
CMD ["npm", "start"]
