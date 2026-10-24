# 개인정보 처리방침

최종 수정: 2026년 10월 25일

Polygon ZIP Uploader는 컴퓨터에 저장된 Codeforces Polygon 문제 패키지 ZIP을 사용자가 지정한 Polygon 문제에 업로드하는 Chrome 확장 프로그램입니다. Codeforces의 공식 제품이 아닙니다.

## 처리하는 정보

- **API 인증:** Polygon API Key와 Secret을 AES-256-GCM으로 암호화해 `chrome.storage.local`에 저장합니다. 복호화용 비추출형 CryptoKey는 같은 Chrome 프로필의 IndexedDB에 보관하며 Key·Secret 원문을 화면에 다시 표시하지 않습니다.
- **문제 패키지:** 사용자가 직접 선택한 ZIP만 로컬에서 읽습니다. 업로드 동안 ZIP을 IndexedDB에 임시 저장합니다. 성공 시 삭제하고, 실패하면 사용자가 재시도하거나 삭제할 때까지 보관합니다.
- **작업 상태:** 파일명, 대상 문제 ID, 진행 상태와 최근 작업 로그를 `chrome.storage.local`에 저장합니다. 로그에는 인증 정보를 표시하지 않도록 처리합니다.
- **기존 버전:** 이전 보관함은 사용자가 암호를 입력해 이전한 후 기존 암호화 기록을 제거합니다.

## 제3자 전송

사용자가 **가져오기**를 실행할 때만 `https://polygon.codeforces.com`에 HTTPS API 요청을 보냅니다. Polygon API Key, API Secret으로 계산한 서명, ZIP에 포함된 지문·소스 코드·테스트 및 문제 설정 등이 전송될 수 있습니다. Secret 원문을 요청 매개변수로 전송하지 않습니다.

정보는 Codeforces Polygon에 문제를 생성하거나 갱신하기 위한 목적으로만 사용합니다. 개발자 운영 서버, 광고 서비스, 추적·분석 서비스로 전송하지 않으며 데이터를 판매하지 않습니다.

## 보관 및 삭제

- 설정 페이지의 **삭제** 버튼으로 API 인증 암호문과 복호화 키를 제거할 수 있습니다.
- 팝업의 **지우기** 버튼으로 완료·실패 작업의 상태와 임시 ZIP을 삭제할 수 있습니다. 업로드 중에는 삭제할 수 없습니다.
- 확장 프로그램 제거 시 확장 프로그램의 Chrome 로컬 데이터도 삭제됩니다.
- 이미 Polygon에 전송한 문제 내용은 확장 프로그램 데이터를 삭제해도 Polygon 서버에서 삭제되지 않습니다.

## 보안 및 한계

API 인증 정보는 암호화하지만 같은 Chrome 프로필의 확장 프로그램 코드는 이를 복호화해 Polygon 요청에 서명할 수 있습니다. 브라우저 프로필 탈취나 악성 코드로부터 완벽히 보호되는 방식은 아닙니다. 공용 PC 사용은 권장하지 않습니다.

요청 권한은 `storage`(인증 정보 및 작업 상태 저장), `offscreen`(팝업이 닫힌 뒤 업로드 계속 수행), `https://polygon.codeforces.com/*`(Polygon API 호출)입니다.

## 문의

[GitHub Issues](https://github.com/rlatjwls7882/polygon-package-importer/issues)에서 기능 및 개인정보 관련 문의를 받습니다.

데이터 처리 방식이 변경되면 이 정책을 갱신합니다.
