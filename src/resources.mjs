// 학생 자료실의 자원 ID 표입니다. 서버 함수(요청 경로)마다 고정하며 query·body·헤더 값으로 바꾸지 않습니다.
export const RESOURCE_IDS = Object.freeze({ notes: 'notes.own', notices: 'notices.instructor' });
