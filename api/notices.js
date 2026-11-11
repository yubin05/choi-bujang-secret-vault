import { authenticateDataRequest, denied } from '../src/auth-session.mjs';
import { RESOURCE_IDS } from '../src/resources.mjs';

// 실습용 가상 강사 공지입니다. 실제 수업 공지·개인정보를 넣지 않습니다.
const NOTICES = Object.freeze([
  { id: '33333333-3333-4333-8333-000000000001', title: '가상 공지 1',
    body: '실습용 가상 강사 공지입니다. 다음 실습 전에 자료실 로그인을 확인하세요.' },
  { id: '33333333-3333-4333-8333-000000000002', title: '가상 공지 2',
    body: '실습용 가상 강사 공지입니다. 메모에는 실제 개인정보를 넣지 마세요.' },
]);

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  // 이 함수의 모든 요청은 강사 공지 자원입니다. 학생 쓰기 경로는 만들지 않습니다.
  response.setHeader('X-Resource-Id', RESOURCE_IDS.notices);
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    // 강사 권한을 저장한 곳이 아직 없어 누구도 강사로 보지 않습니다. 본문·쿼리·화면 메뉴의 role은 읽지 않습니다.
    // 강사의 공지 수정은 저장된 권한을 확인하는 별도 관리 경로에서 처리합니다.
    return denied(response, RESOURCE_IDS.notices, 405, 'METHOD_NOT_ALLOWED', 'NOTICES_READ_ONLY');
  }
  const auth = await authenticateDataRequest(request);
  if (auth.error) return denied(response, RESOURCE_IDS.notices, auth.status, auth.error);
  return response.status(200).json(NOTICES);
}
