import test from "node:test";
import assert from "node:assert/strict";
import { containsUnverifiedContactClaims } from "../src/modules/intelligence/mock-intelligence-engine.js";

test("blocks fabricated support email addresses", () => {
  assert.equal(
    containsUnverifiedContactClaims("ایمیل پشتیبانی: support@hormoz.ai"),
    true,
  );
});

test("blocks phone numbers written with Latin digits", () => {
  assert.equal(
    containsUnverifiedContactClaims("با شماره +98 21 41234567 تماس بگیرید."),
    true,
  );
});

test("blocks phone numbers written with Persian digits", () => {
  assert.equal(
    containsUnverifiedContactClaims("شماره پشتیبانی: ۰۹۱۲۳۴۵۶۷۸۹"),
    true,
  );
});

test("blocks contact and ticket claims even without a number", () => {
  assert.equal(
    containsUnverifiedContactClaims("ساعات کاری پشتیبانی از ۹ تا ۱۸ است."),
    true,
  );
  assert.equal(
    containsUnverifiedContactClaims("کد تیکت شما ۱۲۳۴ است."),
    true,
  );
});

test("blocks invented support-team availability and ticket workflows", () => {
  assert.equal(
    containsUnverifiedContactClaims("تیم پشتیبانی ما آماده پاسخگویی است."),
    true,
  );
  assert.equal(
    containsUnverifiedContactClaims("در سامانه تیکت درخواست شما ثبت شد."),
    true,
  );
});

test("allows ordinary answers that contain no contact claims", () => {
  assert.equal(
    containsUnverifiedContactClaims("من نوا هستم و می‌توانم درباره خدمات هرمز راهنمایی کنم."),
    false,
  );
});
