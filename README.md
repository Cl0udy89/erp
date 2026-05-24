# SparkSome ERP

Własny ERP do obsługi projektów, klientów, czasu pracy, dokumentów finansowych, alokacji kosztów i przychodów, raportów rentowności oraz fundamentu magazynu.

System nie kopiuje struktury Excela jako miesięcznych arkuszy. Źródłem prawdy są rekordy w bazie: dokumenty, alokacje dokumentów, wpisy czasu i ruchy magazynowe. Miesiąc oraz rok są tylko filtrami raportowymi.

## Architektura

Aplikacja jest rozbita na kontenery i usługi:

- `frontend` — aplikacja webowa TanStack Start. Nie ma dostępu do MySQL ani klucza Clockify. Z usługami rozmawia po REST.
- `backend-api` — główny backend REST. Jako jedyna usługa aplikacyjna ma `DATABASE_URL` i zapisuje/czyta dane ERP z MySQL.
- `clockify-sync` — osobna mikrousługa integracyjna Clockify. Ma `CLOCKIFY_KEY`, pobiera dane z Clockify i wysyła je do `backend-api` po REST.
- `mysql` — baza danych ERP z wolumenem `mysql_data`.

Na host wystawiany jest tylko frontend na porcie `3000`. `backend-api`, `clockify-sync` i `mysql` działają w sieci Docker Compose i nie są publikowane na zewnątrz.

Komunikacja między usługami:

- `frontend -> backend-api` po REST,
- `frontend -> clockify-sync` po REST dla ręcznego uruchomienia synchronizacji,
- `clockify-sync -> backend-api` po REST dla importu danych Clockify,
- `backend-api -> mysql` przez `mysql2`.

Usługi REST używają wewnętrznego tokena `API_INTERNAL_TOKEN`. W produkcji ustaw własną wartość.

## Uruchomienie

Utwórz plik `.env` w katalogu projektu na bazie przykładu:

```bash
cp .env.example .env
```

Następnie uzupełnij wartości:

```env
CLOCKIFY_KEY=twoj_klucz_clockify
CLOCKIFY_BASE_URL=https://api.clockify.me/api/v1
API_INTERNAL_TOKEN=dlugi-losowy-token-wewnetrzny
MYSQL_PASSWORD=bezpieczne_haslo_mysql
MYSQL_ROOT_PASSWORD=bezpieczne_haslo_root_mysql
DATABASE_URL=mysql://erp:bezpieczne_haslo_mysql@mysql:3306/erp
```

Plik `.env` jest ignorowany przez Git. Do repo trafia tylko `.env.example`.

Uruchom:

```bash
docker compose up --build
```

Aplikacja będzie dostępna pod:

```text
http://localhost:3000
```

Nie uruchamiaj dev servera, jeśli działa już lokalnie zgodnie z zasadami projektu.

## Technologie

- Bun
- Vite+ / TanStack Start
- TanStack Router
- TanStack Query
- MySQL 8.4
- `mysql2`
- Zod
- Tailwind CSS
- Radix UI / shadcn-style components

Backend i mikrousługi są w TypeScript/Bun, żeby zachować typowanie i spójność z projektem.

## Widoki

| Ścieżka         | Opis                                                       |
| --------------- | ---------------------------------------------------------- |
| `/`             | Dashboard                                                  |
| `/people`       | Pracownicy i godziny                                       |
| `/projects`     | Projekty i godziny                                         |
| `/time-entries` | Wpisy czasu                                                |
| `/financials`   | Dokumenty finansowe, alokacje, rejestr, raporty projektowe |
| `/inventory`    | Produkty, ruchy magazynowe, wartość magazynu               |
| `/reports`      | Raport godzin i kosztów                                    |
| `/invoices`     | Widok faktur                                               |

## Moduł finansowy

Główne tabele:

- `erp_financial_documents`
- `erp_financial_document_allocations`
- `erp_financial_categories`
- `erp_tax_rates`
- `erp_accounting_periods`

Dokument finansowy jest źródłem, np. fakturą sprzedażową, fakturą kosztową, rachunkiem, dokumentem wewnętrznym albo wpisem wirtualnym.

Alokacja dokumentu jest wpisem projektowym. Jeden dokument może mieć wiele alokacji do różnych projektów. Dzięki temu jedna faktura lub rachunek może być rozbity na kilka projektów kwotowo albo procentowo.

Status alokacji dokumentu:

- `NOT_ALLOCATED`
- `PARTIALLY_ALLOCATED`
- `FULLY_ALLOCATED`
- `OVER_ALLOCATED`

Logika finansowa jest w:

```text
src/lib/finance-domain.ts
src/lib/finance-service.ts
```

Akcje REST obsługiwane przez `backend-api`:

- dokumenty: lista, szczegóły, tworzenie, aktualizacja, usuwanie,
- alokacje: dodanie, aktualizacja, usunięcie,
- split dokumentu kwotowy,
- split dokumentu procentowy,
- rejestr finansowy,
- raport miesięczny projektów,
- raport YTD,
- dokumenty niezaalokowane,
- dokumenty częściowo zaalokowane.

## Formuły finansowe

Przychód w PLN:

```text
przychod_pln = przychod_waluta_obca * kurs
```

Zysk z przychodu:

```text
zysk = przychod - koszt_uslug_netto - zrealizowany_koszt_towaru - pozostale_koszty_operacyjne
```

Koszt zakupu towaru nie obniża bezpośrednio zysku projektu. Zwiększa zatowarowanie. Zysk obniża dopiero zrealizowany koszt towaru.

CIT:

```text
tax_effect = zysk * stawka_cit
tax_payable = max(0, tax_effect)
zysk_po_cit = zysk - tax_payable
```

Zatowarowanie:

```text
zatowarowanie = koszt_zakupu_towaru - zrealizowany_koszt_towaru
```

YTD jest liczone zapytaniem od 1 stycznia do końca wybranego miesiąca.

## Magazyn

Fundament magazynu obejmuje:

- `erp_products`
- `erp_stock_movements`

Obsługiwane typy ruchów:

- `OPENING_BALANCE`
- `PURCHASE`
- `ISSUE_TO_PROJECT`
- `SALE`
- `CORRECTION`
- `RETURN`

FIFO nie jest jeszcze zaimplementowane. Model jest przygotowany tak, żeby dodać je później bez przepisywania dokumentów finansowych.

## Import z Excela

Widok `/financials` zawiera zakładkę importu Excela. Użytkownik wybiera plik `.xlsx` albo `.xls`, a frontend wysyła go do `backend-api` jako dane wejściowe do podglądu. Backend parsuje arkusze miesięczne, rozpoznaje kolumny z dotychczasowego pliku `Rozliczenia projektów`, dopasowuje projekty po nazwie i zwraca propozycję importu.

Import działa dwuetapowo:

1. `POST /imports/excel/preview` — parsuje plik i zwraca edytowalne wiersze robocze z ostrzeżeniami.
2. `POST /imports/excel/commit` — zapisuje zaakceptowane wiersze jako `FinancialDocument` oraz `FinancialDocumentAllocation`.

Na etapie podglądu można zaznaczyć, które wiersze mają być importowane, zmienić projekt, datę, nazwę dokumentu, typ transakcji i kwoty. Wiersze z tego samego dokumentu są grupowane, więc kilka pozycji z Excela może utworzyć jeden dokument źródłowy z wieloma alokacjami projektowymi.

Importer nie traktuje arkusza miesiąca jako modelu biznesowego. Nazwa arkusza pomaga tylko odczytać datę, jeśli wiersz jej nie ma. Źródłem prawdy po imporcie są dokumenty i alokacje w bazie.

## Importy przyszłościowe

Model dokumentów zawiera pola:

- `source_system`
- `external_id`
- `import_status`
- `raw_payload`
- `file_url`

Dzięki temu później można dodać importery z KSeF albo zewnętrznego ERP. Importer powinien tworzyć `FinancialDocument`, a użytkownik wykonuje alokację na projekty.

## Clockify

`clockify-sync` pobiera:

- workspace,
- klientów,
- projekty,
- pracowników,
- wpisy czasu.

Synchronizator nie zapisuje bezpośrednio do MySQL. Wysyła dane do `backend-api` przez endpoint REST importu wewnętrznego.

Klucz `CLOCKIFY_KEY` musi być prawdziwym API key z Clockify Profile Settings. Jeżeli workspace działa na subdomenie albo regionalnym serwerze Clockify, wygeneruj klucz dla tego workspace i ustaw odpowiedni `CLOCKIFY_BASE_URL`, np. `https://euc1.clockify.me/api/v1`.

## Testy

Testy logiki finansowej:

```bash
docker compose build backend-api
docker compose run --rm --no-deps backend-api bun test src/lib/finance-domain.test.ts
```

Aktualnie testy obejmują:

- przychód usługowy,
- koszt i ujemny efekt podatkowy,
- przychód w walucie obcej,
- zakup towaru,
- zrealizowany koszt towaru,
- pełną alokację dokumentu,
- częściową alokację,
- nadmiarową alokację,
- zakres miesięczny i YTD.

## Walidacja builda

```bash
docker compose config
docker compose build frontend backend-api clockify-sync
```

`vp check` jest wymaganym checkiem projektu, ale wymaga lokalnie zainstalowanego `vp`. W kontenerze build produkcyjny wykonuje `vp build`.
