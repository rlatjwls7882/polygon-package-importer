# Polygon ZIP Uploader

Codeforces Polygon 문제 패키지 ZIP을 업로드해 새 문제를 만들거나 기존 문제를 갱신하는 Chrome 확장 프로그램입니다.

**[Chrome 웹스토어에서 설치](https://chromewebstore.google.com/detail/polygon-zip-uploader/fhlocfeafcanblbeppffhdilbkblmdcn)**

## 사용 방법

1. [Polygon API 설정](https://polygon.codeforces.com/settings)에서 API Key와 Secret을 발급합니다.
2. 확장 프로그램을 열어 API Key와 Secret을 등록합니다.
3. `problem.xml`이 포함된 ZIP 파일을 선택하고 **새 문제** 또는 **기존 문제**를 선택합니다. 기존 문제는 문제 ID를 입력합니다.
4. **Polygon에 업로드**를 누릅니다.

팝업을 닫아도 업로드는 계속되며, 중단된 작업은 **다시 시도**할 수 있습니다.

> **주의:** 기존 문제에 덮어쓰면 ZIP에 없는 파일·테스트·지문 첨부물이 삭제될 수 있습니다. 자동 백업은 제공하지 않습니다.

기본 `tests` 테스트셋만 지원하며, ZIP에 포함된 새 지문 이미지·바이너리 첨부물은 업로드할 수 없습니다. ZIP 크기 제한은 100MB입니다.

[문의 및 버그 제보](https://github.com/rlatjwls7882/polygon-package-importer/issues) · [개인정보 처리방침](PRIVACY.md) · [라이선스](LICENSE)

Codeforces의 공식 확장 프로그램이 아닙니다.
