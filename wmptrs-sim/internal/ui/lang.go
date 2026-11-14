package ui

import "fmt"

// Bahasa Indonesia covers the presentation path: the Menu, the Guide
// slides and the raincoat alerts. The analysis screens stay in English,
// because their numbers and terms match the paper.
var langID bool

// SetIndonesian switches the presentation text to Bahasa Indonesia.
func SetIndonesian(on bool) { langID = on }

// L picks the English or Indonesian string.
func L(en, id string) string {
	if langID {
		return id
	}
	return en
}

var idSections = map[string]string{
	"what the model is and why":             "apa modelnya dan mengapa",
	"see it work on a map":                  "lihat cara kerjanya di peta",
	"run it on hundreds of journeys":        "jalankan pada ratusan perjalanan",
	"data, statistics and reviewer answers": "data, statistik, dan jawaban untuk reviewer",
}

var idMenu = map[int][2]string{
	scrGuide: {"16 slide bergambar: masalah → ide → matematika → dampak",
		"«Mulai di sini.» Setiap slide memasangkan gambar animasi dengan penjelasan singkat. ‹←→› untuk berpindah, ‹p› untuk autoplay saat presentasi."},
	scrSymbols: {"setiap simbol (β, φ, E, r0, k, σ …) beserta arti dan efeknya",
		"Kartu referensi per variabel: artinya, satuan dan nilai default, «mengapa model membutuhkannya», dan apa yang terjadi bila dinaikkan atau diturunkan."},
	scrCases: {"8 perjalanan buatan tangan di peta kota, sepenuhnya interaktif",
		"Cerita konkret: pindah moda, jalan memutar, gerimis, tebing ambang batas, prakiraan yang salah. Geser badai dengan tombol panah dan lihat rutenya berubah. ‹s› menganimasikan Dijkstra, ‹h› menampilkan peta panas penalti."},
	scrAlert: {"badai bergerak: rute menurut hujan yang akan ditemui + peringatan jas hujan",
		"Badai bergerak seperti nowcast sungguhan. Membandingkan A0, DP dengan hujan «saat ini», dan DP dengan hujan «yang akan Anda temui». Notifikasi memperingatkan sebelum hujan tiba dan memberi tahu di mana «memakai jas hujan». ‹space› putar/jeda, ‹←→› geser waktu, ‹v› rute."},
	scrParams: {"atur β, r0, k, galat prakiraan, jumlah perjalanan, seed",
		"Slider untuk setiap parameter, plus 4 preset. ‹enter› memulai run dengan pengaturan ini."},
	scrRun: {"lihat kelima varian merutekan setiap perjalanan secara langsung",
		"Perjalanan masuk satu per satu. Peta menggambar rute A3 di atas rute A0 yang redup. Telusuri perjalanan yang selesai dengan ‹←→›."},
	scrResults: {"pengurangan dosis hujan, CI, uji signifikansi",
		"Hasil utama: total pengurangan dosis per varian dengan CI bootstrap 95 %, uji Friedman dan Wilcoxon dengan koreksi Holm, serta tabel hasil."},
	scrTradeoff: {"biaya waktu vs hujan yang dihindari saat β naik",
		"Merutekan ulang perjalanan yang sama untuk β dari 0 sampai 8, untuk A1, A2, dan A3. Menampilkan seluruh kurva trade-off, bukan satu pengaturan saja."},
	scrPhi: {"bentuk kurva φ dengan r0, k, dan β",
		"Kurva pengali biaya interaktif per kelas paparan, dengan overlay A1 dan A2. Perubahan terbawa ke run berikutnya."},
	scrData: {"asal setiap angka: jaringan, hujan, galat prakiraan",
		"Distribusi dari run saat ini, plus sumber setiap konstanta (asumsi, kategori BMKG, atau pilihan desain)."},
	scrRobust: {"20 seed, sensitivitas E / w_m, badai bergerak, POD/FAR peringatan",
		"Menjalankan ulang semuanya berkali-kali: «20 seed independen», perubahan satu per satu pada «E dan w_m» yang diasumsikan, eksperimen «badai bergerak» (DP-now vs DP-ahead, dengan galat prakiraan gerak) dan skor verifikasi «peringatan jas hujan». Sekitar 5 detik."},
	scrQA: {"jawaban atas pertanyaan yang kemungkinan diajukan reviewer",
		"Mengapa algoritma ini, mengapa sigmoid, mengapa uji-uji ini, mengapa aplikasi perlu mengadopsinya, dan batasannya. Beberapa jawaban mengutip angka langsung dari run Anda. (Layar ini dalam bahasa Inggris.)"},
	scrBench: {"mikrodetik per pemanggilan routing, per varian",
		"Menunjukkan biaya berbasis cuaca hampir tidak menambah beban routing."},
}

func entryPurpose(e menuEntry) string {
	if t, ok := idMenu[e.screen]; ok && langID {
		return t[0]
	}
	return e.purpose
}

func entryDetail(e menuEntry) string {
	if t, ok := idMenu[e.screen]; ok && langID {
		return t[1]
	}
	return e.detail
}

func sectionBlurb(b string) string {
	if t, ok := idSections[b]; ok && langID {
		return t
	}
	return b
}

type idSlide struct {
	title string
	text  func(a *App) string
}

func slideTitle(sl slide) string {
	if t, ok := idSlides[sl.title]; ok && langID {
		return t.title
	}
	return sl.title
}

func slideText(sl slide, a *App) string {
	if t, ok := idSlides[sl.title]; ok && langID {
		return t.text(a)
	}
	return sl.text(a)
}

// idSlides is keyed by the English slide title.
var idSlides = map[string]idSlide{
	"Rain changes how people should travel": {"Hujan mengubah cara orang seharusnya bepergian", static(
		"Musim hujan di Jakarta membawa badai konvektif yang singkat, deras, dan sangat «lokal». Satu kecamatan bisa kering sementara kecamatan sebelahnya hujan lebat.\n\n" +
			"Banyak perjalanan memakai moda «terbuka»: motor dan ojek, berjalan kaki ke halte, menunggu di halte BRT yang beratap tetapi terbuka.\n\n" +
			"Aplikasi navigasi mengurutkan pilihan «hanya berdasarkan waktu». Aplikasi akan mengirim Anda naik motor menembus badai, padahal perjalanan kereta yang terlindung hampir sama cepatnya.\n\n" +
			"«Pertanyaan penelitian:» bisakah router menukar beberapa menit dengan pengurangan paparan hujan yang besar, hanya dengan prakiraan?")},
	"Price rain into every edge of the graph": {"Masukkan harga hujan ke setiap sisi graf", static(
		"Router (Dijkstra) tetap sama. Yang diubah hanya «cara setiap sisi diberi harga».\n\n" +
			"Setiap sisi mendapat biaya waktu normal ‹τ·w_m›, dikalikan ‹penalti ketidaknyamanan› yang naik bersama hujan prakiraan, tetapi hanya sebesar tingkat «paparan» sisi itu.\n\n" +
			"Dua sifat penting:\n" +
			"• «kering = tidak berubah»: tanpa hujan, biayanya persis sama dengan biaya waktu saja.\n" +
			"• «terbatas»: bahkan dalam hujan ekstrem, biaya sisi paling banyak naik (1+β·E)×, sehingga router tidak pernah memilih jalan memutar yang tidak masuk akal.")},
	"Five cost functions, one experiment": {"Lima fungsi biaya, satu eksperimen", static(
		"Untuk menunjukkan model usulan «lebih baik», bukan sekadar «berbeda», setiap perjalanan dirutekan lima kali:\n\n" +
			"• ‹A0› adalah kontrol: router masa kini.\n" +
			"• ‹A1› dan ‹A2› adalah ide sederhana yang mungkin diusulkan reviewer: ambang batas hujan dan penalti linear.\n" +
			"• ‹A3› adalah Discomfort Penalty kami.\n" +
			"• ‹A4› adalah «ablasi». Paparan saat menunggu dihapus, untuk menguji apakah bagian model itu berguna. Ternyata tidak: A4 setidaknya sama baik di setiap seed dan pengaturan, jadi waktu tunggu dinilai tetapi «tidak diberi harga» dalam routing.\n\n" +
			"Perjalanan sama, prakiraan sama, kondisi sebenarnya sama. Ini desain «berpasangan».")},
	"τ and w_m: time, and how time feels": {"τ dan w_m: waktu, dan bagaimana waktu terasa", static(
		"‹τ› (tau) adalah waktu tempuh sebuah sisi dalam menit: berjalan 1 km, naik kendaraan di antara dua halte, atau menunggu bus.\n\n" +
			"‹w_m› adalah bobot nilai waktu untuk moda tersebut. Dalam perencanaan transportasi, waktu di luar kendaraan (berjalan, menunggu) diberi bobot lebih tinggi daripada waktu di dalam kendaraan, karena orang lebih tidak menyukainya. Meta-analisis (Wardman dkk.) menempatkan pengali ini sekitar 1,5 sampai 2. Kami memakai nilai konservatif ‹1,5› untuk berjalan dan menunggu, dan ‹1,0› untuk berkendara.\n\n" +
			"«Mengapa penting:» tanpa w_m, baseline waktu saja akan terlalu senang berjalan kaki, sehingga setiap hasil hujan dibandingkan dengan lawan yang lemah.")},
	"E: how exposed is each edge?": {"E: seberapa terpapar setiap sisi?", static(
		"‹E› (paparan, 0 … 1) menyatakan seberapa banyak hujan benar-benar mengenai pelaku perjalanan di sisi itu.\n\n" +
			"• Berjalan kaki dan motor: ‹1,0›, sepenuhnya di ruang terbuka.\n" +
			"• Menunggu di halte BRT: ‹0,4›. Ada atap, tetapi sisinya terbuka dan hujan terbawa angin.\n" +
			"• Menunggu di stasiun kereta: ‹0,1›, tertutup kecuali jalan aksesnya.\n" +
			"• Di dalam kendaraan: ‹0›.\n\n" +
			"⟦Ini asumsi pemodelan, bukan hasil pengukuran.⟧ A4 menguji salah satunya, dan E yang sama dipakai untuk «menilai» setiap varian, sehingga tidak ada varian yang diuntungkan.")},
	"r and r_f: real rain vs the forecast": {"r dan r_f: hujan sebenarnya vs prakiraan", static(
		"‹r› adalah intensitas hujan dalam mm/jam. Kategorinya mengikuti skala per jam BMKG: «ringan» 1–5, «sedang» 5–10, «lebat» 10–20, «sangat lebat» di atas 20.\n\n" +
			"Router tidak pernah melihat hujan sebenarnya. Router melihat ‹r_f›, prakiraan yang:\n" +
			"• «berpetak»: dirata-rata per petak 2×2 km, seperti grid nowcast,\n" +
			"• «bergeser»: seluruh medan digeser ‹shift› km,\n" +
			"• «bergalat»: setiap petak dikalikan galat log-normal ‹σ›.\n\n" +
			"Rute «dipilih» dengan r_f dan «dinilai» dengan r. Itulah cara jujur mengevaluasi router berbasis prakiraan.")},
	"φ(r): turning mm/h into discomfort": {"φ(r): mengubah mm/jam menjadi ketidaknyamanan", static(
		"‹φ› memetakan intensitas hujan ke tingkat ketidaknyamanan antara 0 dan 1, memakai kurva logistik (sigmoid) dengan dua parameter:\n\n" +
			"• ‹r0›, «titik tengah»: intensitas saat ketidaknyamanan mencapai separuh (default 5 mm/jam, batas ringan/sedang BMKG).\n" +
			"• ‹k›, «kecuraman»: seberapa cepat ketidaknyamanan naik di sekitar r0 (default 0,74).\n\n" +
			"Sigmoid mentah σ(0) sedikit di atas 0, jadi kami «menormalkan»: φ(r) = (σ(r) − σ(0)) / (1 − σ(0)). Ini menjamin ‹φ(0) = 0›, sehingga sisi kering tidak tersentuh.\n\n" +
			"Nilai acuan: φ(1)=0,03, φ(5)=0,49, φ(7,5)=0,86, φ(10)=0,98.")},
	"Why a sigmoid, not a threshold or a line?": {"Mengapa sigmoid, bukan ambang batas atau garis lurus?", static(
		"Titik putih adalah prakiraan yang bergoyang ±30 % di sekitar r0, seperti prakiraan sungguhan.\n\n" +
			"• ‹A1 ambang batas› melompat antara ×1 dan ×(1+β). Galat prakiraan yang kecil membalik seluruh rute, sehingga keputusan di sekitar r0 tampak acak.\n" +
			"• ‹A2 linear› mengabaikan semua di bawah r0 dan naik «tanpa batas». Satu petak 40 mm/jam bisa mendominasi seluruh perjalanan.\n" +
			"• ‹A3 sigmoid› «mulus», jadi galat kecil hanya menimbulkan perubahan kecil. Ia «terbatas», karena basah kuyup ya basah kuyup. Ia «bertingkat», jadi gerimis tetap dihitung sedikit.\n\n" +
			"Lihat langsung di Kasus 4 dan 5.")},
	"β: the traveller's trade-off": {"β: kompromi pelaku perjalanan", func(a *App) string {
		return "‹β› (beta) adalah bobot suku ketidaknyamanan, yaitu «seberapa orang ini tidak suka hujan».\n\n" +
			"• ‹β = 0›: DP dimatikan dan router identik dengan A0.\n" +
			"• ‹β = 1› (default): satu menit terpapar penuh dalam hujan lebat terasa seperti «dua» menit kering.\n" +
			"• ‹β = 4›: sangat menghindari hujan, rela jalan memutar jauh lebih lama.\n\n" +
			"Di aplikasi, β adalah «slider preferensi pengguna»: komuter berjas dan mahasiswa berjas hujan menginginkan jawaban yang berbeda.\n\n" +
			fmt.Sprintf("β saat ini = ‹%.2f›. Layar Trade-off menyapu β ∈ {0 … 8} untuk menampilkan seluruh kurva waktu vs hujan.", a.params.Beta)
	}},
	"The synthetic city": {"Kota sintetis", static(
		"Eksperimen berjalan di kota sintetis yang «terkendali», sehingga hujan sebenarnya di setiap sisi diketahui pasti:\n\n" +
			"• Kisi 30 × 16 km dengan lapisan «jalan kaki» (5 km/jam) dan «motor» (22 km/jam) terpisah, dengan variasi waktu tempuh acak ber-seed.\n" +
			"• ‹11 jalur BRT› (20 km/jam, tunggu 4 menit, halte terbuka) dan ‹2 jalur kereta› (40 km/jam, tunggu 6 menit termasuk akses).\n" +
			"• Setiap perjalanan: asal dan tujuan acak berjarak minimal 8 km, dengan 1–3 sel badai Gaussian (puncak 10–40 mm/jam) di dekat koridornya.\n\n" +
			"Layar «Data» menampilkan distribusi sebenarnya.")},
	"How a route is chosen": {"Bagaimana rute dipilih", static(
		"Untuk setiap perjalanan dan setiap varian:\n\n" +
			"1. Ambil hujan «prakiraan» di setiap sisi.\n" +
			"2. Beri «harga» setiap sisi dengan fungsi biaya varian itu.\n" +
			"3. Jalankan «Dijkstra dua kali»: motor dari pintu ke pintu, dan jalan kaki + BRT + kereta.\n" +
			"4. Ambil yang lebih murah. Inilah «pemilihan moda».\n" +
			"5. Nilai jalur terpilih dengan hujan «sebenarnya».\n\n" +
			"Di layar Kasus tekan ‹s› untuk «melihat» langkah 3. Muka pencarian terlihat mengalir di sekitar badai.")},
	"Rain that has not arrived yet": {"Hujan yang belum tiba", static(
		"Badai «bergerak». Memberi harga sisi berdasarkan hujan «saat ini» tidak cukup:\n\n" +
			"• Rute yang kering sekarang bisa berada di bawah badai 20 menit lagi.\n" +
			"• Badai di atas rute sekarang mungkin sudah pergi saat Anda tiba. Menghindarinya bahkan bisa membawa Anda «masuk» ke jalurnya.\n\n" +
			"Jadi router melihat hujan di setiap sisi «pada menit Anda akan tiba di sana», memakai gerak badai seperti yang diprediksi nowcast.\n\n" +
			"Bila hujan tidak terhindarkan, sistem «memperingatkan lebih awal»: \"hujan di depan Anda dalam 15 menit, menepi dan pakai jas hujan\". E yang sama dipakai, jadi Anda tidak diperingatkan saat berada di dalam kereta.\n\n" +
			"Coba di layar «Rain alert».")},
	"What we measure": {"Apa yang kami ukur", static(
		"• ‹T› adalah waktu tempuh dalam menit. «Biaya» menjadi sadar cuaca.\n" +
			"• ‹D› adalah «dosis hujan», D = Σ τ·E·r_true / 60, dalam mm hujan yang diterima. Hasil utama.\n" +
			"• «Menit terpapar» adalah waktu di sisi terbuka saat hujan sebenarnya ≥ r0.\n" +
			"• «Pangsa motor» dan «pangsa ganti rute» menunjukkan perubahan perilaku.\n" +
			"• ‹Presisi / recall / F1› bertanya: saat rute yang lebih kering benar-benar ada (oracle = A3 dengan hujan sebenarnya), apakah router prakiraan menemukannya? Saat ia mengganti rute, apakah itu sepadan?\n\n" +
			"Pengurangan dosis dilaporkan «relatif terhadap A0» pada perjalanan yang sama.")},
	"Is the difference real?": {"Apakah perbedaannya nyata?", static(
		"Setiap perjalanan memberi lima dosis «berpasangan», satu per varian, dan dosisnya miring dengan banyak nol. Jadi kami memakai uji «non-parametrik berpasangan»:\n\n" +
			"1. ‹Friedman› menguji apakah ada varian yang berbeda.\n" +
			"2. ‹Wilcoxon signed-rank›, A3 vs setiap varian lain, menguji yang mana.\n" +
			"3. Koreksi ‹Holm›, karena kami menguji 4 kali. Ini mengendalikan galat family-wise.\n" +
			"4. CI ‹bootstrap› 95 %, 2000 resampel, menjawab «seberapa besar» efeknya, bukan hanya ada atau tidak.\n\n" +
			"Semua keacakan ber-seed: seed yang sama memberi angka yang sama.")},
	"Why apps should adopt it": {"Mengapa aplikasi perlu mengadopsinya", static(
		"• «Perubahan kecil»: satu perkalian per sisi, di dalam fungsi bobot sisi yang sudah dimiliki mesin routing. Tanpa algoritma baru, tanpa struktur data baru.\n" +
			"• «Aman sejak rancangan»: cuaca kering atau β = 0 menghasilkan rute yang persis sama dengan hari ini.\n" +
			"• «Cepat»: Dijkstra yang sama, kompleksitas yang sama (lihat layar Bench).\n" +
			"• «Personal»: β adalah pengaturan pengguna.\n" +
			"• «Mudah dijelaskan»: \"+6 menit, hujan berkurang 80 %\" adalah pesan yang dipahami pengguna.\n" +
			"• «Memakai data yang sudah ada»: nowcast BMKG / OpenWeatherMap.\n\n" +
			"Untuk kota yang sering hujan dan dipenuhi motor, ini adalah fitur «kenyamanan dan keselamatan».")},
	"What this model does not claim": {"Apa yang tidak diklaim model ini", static(
		"Reviewer pasti bertanya tentang batasan, jadi kami menyatakannya lebih dulu:\n\n" +
			"• Kotanya «sintetis». Ini memisahkan model biaya dari derau data peta, tetapi bukan jaringan Jakarta yang sebenarnya.\n" +
			"• Nilai E dan w_m adalah «asumsi». Grid sensitivitas menunjukkan urutan hasil tetap bertahan, dan survei stated-preference akan mengkalibrasinya.\n" +
			"• Dalam eksperimen utama, hujan statis selama perjalanan. Eksperimen badai bergerak melonggarkan ini dengan adveksi sederhana, bukan nowcast sungguhan.\n" +
			"• Tidak ada kepadatan penumpang atau perlambatan lalu lintas akibat hujan.\n" +
			"• Hasil bervariasi menurut seed. Hasil ini «bukan» run asli makalah.\n\n" +
			"⟦Berikutnya:⟧ layar «Symbols» berisi kartu referensi untuk setiap variabel.")},
}
