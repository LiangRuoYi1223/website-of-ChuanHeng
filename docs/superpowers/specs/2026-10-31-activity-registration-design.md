# 活动报名、候补与手动缴费管理

用户要求后台双击活动打开报名管理，按报名时间显示所有报名人员、缴费情况和完整操作日志；活动预设名额，会员看到个人当前排位/名额（如10/5）。用户已确认：按当前有效报名时间递补，名额内入选，其余候补，退出后后续人员前移。

## 确定行为
- 普通会员仅可查看自己及匿名汇总，不泄露他人报名、邮箱或缴费。管理员查看完整名单与日志。
- 活动 payload.registrationCapacity 为正整数；旧活动缺失不补造，需管理员明确填写后才开放新报名。
- 入选且未缴费者在页面内收到缴费提示，候补暂不提示缴费；不发送邮件或外部消息，不接支付系统。
- 会员活动开始前可以退出；重新报名须在报名窗口内并排到当前队尾。退出记录与付款状态保留，不自动退款或重置缴费。
- 缴费仅管理员手动切换 paid/unpaid，包含并发旧值检查；不实现自动缴费调整。
- 日志追加保存报名、退出、重新报名、缴费变更和名额修改的时间、对象、操作者及前后值。来源保留self_service/manual/automatic的模型；automatic目前没有可调用的写入功能。
- 服务端按服务器时间检查报名窗口，串行化同一活动的报名操作，稳定排序。活动历史轨迹及旧chuanheng数据不变。

## 前后端契约
公开RPC均固定search_path并检查auth.uid；权限由受信app_metadata.role决定，拒绝伪造user_metadata。
- get_activity_registration(p_activity_id uuid): 返回本人状态 State。
- register_activity(p_activity_id uuid,p_expected_user_id uuid): 报名/重新报名，返回 State，重复请求不重复报名。
- withdraw_activity_registration(p_activity_id uuid,p_expected_user_id uuid): 本人退出，返回 State，重复请求不重复写日志。
- get_activity_registrations(p_activity_id uuid): 管理员返回 AdminState。
- set_activity_registration_payment(p_application_id uuid,p_payment_status text,p_expected_payment_status text,p_expected_user_id uuid): 管理员切换，返回 AdminState。

State={capacity:number|null,activeCount:number,confirmedCount:number,waitlistCount:number,canWithdraw:boolean,application:Application|null}。
Application={id,userId,displayName,email,createdAt,registeredAt,status:'active'|'withdrawn',paymentStatus:'unpaid'|'paid',position:number|null,selectionStatus:'confirmed'|'waitlisted'|'withdrawn'|'unconfirmed'}。
AdminState={viewerId,capacity,activeCount,confirmedCount,waitlistCount,applications:Application[],events:Event[]}。
Event={id,action:'registered'|'withdrawn'|'rejoined'|'payment_changed'|'capacity_changed',actorId,actorLabel,actorType:'member'|'admin'|'system',source:'self_service'|'manual'|'automatic',subjectUserId,subjectLabel,occurredAt,details:object}。
所有时间用ISO字符串。名单按registeredAt稳定升序。日志按occurredAt和id倒序。候补position为当前有效队列总排位，如10/5；已退出者position=null。

## 数据与权限
沿用public.applications，不重建、不删除历史报名；新增状态和排序列、独立追加事件表。普通用户不能伪造时间、队列、付款或日志。优先SECURITY INVOKER；如为本人匿名汇总跨越RLS确有必要，可用非暴露private schema中的最小SECURITY DEFINER助手，限定执行授权、固定search_path、验证身份、只返回本人及汇总，禁止通用提权。日志写入同样必须由受控触发器完成。完整角色及直接DML攻击用隔离数据库测试。

## 文件分工
数据库代理仅写新迁移supabase/migrations/20261031163237_activity_registration_management.sql及新隔离SQL验证脚本；不应用生产迁移。
会员页面代理写src/applications/registration.js、ActivityApplication.jsx、application.css、tests/applications.test.mjs及独立新会员DOM测试；不改生产综合DOM测试。
管理员页面代理写src/applications/ActivityRegistrationAdmin.jsx、admin-registration.js、admin-registration.css及独立新DOM/服务测试；不改Admin.jsx。
主代理写Admin.jsx接入、名额字段、综合测试兼容、文档及最终集成。

接口修订：三个写RPC的p_expected_user_id必须等于auth.uid，防止核实身份后会话切换误写其他账号；后台用AdminState.viewerId绑定最初加载名单的管理员。
