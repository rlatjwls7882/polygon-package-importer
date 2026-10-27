# 개인정보 처리방침

[English](PRIVACY.md) · 2026년 10월 27일 수정

Polygon ZIP Uploader는 문제 패키지를 Codeforces Polygon에 업로드하는 비공식 Chrome 확장 프로그램입니다.

## 기기에 저장되는 정보

- Polygon API Key와 Secret은 AES-256-GCM으로 암호화해 `chrome.storage.local`에 저장합니다. 복호화용 비추출형 키는 같은 Chrome 프로필의 IndexedDB에 보관합니다.
- 선택한 ZIP은 업로드 중 IndexedDB에 임시 저장합니다. 성공하면 삭제하며 실패한 작업은 재시도하거나 지울 때까지 보관합니다.
- 파일명, 문제 ID, 상태, 최근 로그를 로컬에 저장합니다. 로그에는 API 인증 정보가 표시되지 않도록 처리합니다.

## Polygon으로 전송되는 정보

사용자가 업로드를 시작하면 `https://polygon.codeforces.com`으로 API Key, API 서명, 문제 생성·갱신에 필요한 패키지 내용을 전송합니다. API Secret 원문은 전송하지 않습니다.

분석 도구, 광고 추적, 개발자 운영 수집 서버를 사용하지 않으며 정보를 판매하지 않습니다.

## 삭제 및 한계

**API 키 → 삭제**에서 저장된 키를 삭제하고, 완료·실패 작업은 **지우기**로 삭제할 수 있습니다. 확장 프로그램을 제거하면 확장 프로그램의 로컬 데이터도 삭제됩니다. 이미 Polygon에 업로드한 내용은 삭제되지 않습니다.

암호화는 브라우저 프로필을 제어하는 악성 코드까지 방어하지 못합니다. 신뢰할 수 없는 공용 PC에서는 API 인증 정보를 사용하지 않는 것이 좋습니다.

[문의 및 버그 제보](https://github.com/rlatjwls7882/polygon-package-importer/issues)
