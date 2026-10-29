<template>
  <div class="space-y-5 animate-fade-in">
    <PageHeader title="免责声明" description="使用本软件前请仔细阅读以下声明" />

    <div class="card p-6 md:p-8 space-y-4">
      <div class="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-900/30">
        <Icon name="alert" class="text-amber-500 mt-0.5 shrink-0" />
        <p class="text-sm text-amber-700 dark:text-amber-300">
          本声明构成您与开发者之间具有法律效力的协议。点击「我已阅读并同意」即视为您已充分理解并接受全部条款。
        </p>
      </div>

      <div class="prose prose-slate dark:prose-invert max-w-none text-sm leading-relaxed space-y-3 text-slate-700 dark:text-slate-300">
        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">1. 软件性质</h3>
          <p>本软件（闲鱼超级管家）为开源学习研究项目，仅供技术爱好者学习交流使用，不构成任何商业产品或服务。开发者不对软件的可用性、稳定性或适用性作任何明示或暗示的担保。</p>
        </section>

        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">2. 严禁商业用途</h3>
          <p>未经开发者书面许可，不得将本软件用于任何商业用途，包括但不限于：售卖、出租、捆绑销售、托管服务、SaaS 化运营、作为商业产品的一部分分发等。违反者将承担由此产生的一切法律责任。</p>
        </section>

        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">3. 使用风险与责任</h3>
          <p>使用者应自行评估并承担使用本软件可能带来的全部风险，包括但不限于账号被封禁、数据丢失、经济损失、法律纠纷等。<strong>因使用本软件而产生的任何直接或间接后果，均由使用者自行承担，与开发者无关。</strong></p>
        </section>

        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">4. 合规使用要求</h3>
          <p>使用者应确保其使用行为符合所在国家或地区的法律法规，以及相关平台（闲鱼 / Goofish / 淘宝 / 阿里巴巴等）的服务条款。不得利用本软件从事任何违法违规活动，包括但不限于虚假交易、刷单、欺诈、侵权、绕过平台安全机制等。</p>
        </section>

        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">5. 知识产权</h3>
          <p>本软件的源代码遵循其开源协议。涉及第三方接口、商标、品牌等内容，相关权利归原权利人所有，本软件不对之主张任何权利。</p>
        </section>

        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">6. 免责条款</h3>
          <p>在任何情况下，开发者均不对因使用或无法使用本软件而导致的任何损失（包括数据丢失、业务中断、利润损失等）承担责任。</p>
        </section>

        <section>
          <h3 class="font-semibold text-slate-900 dark:text-white text-base mb-1.5">7. 声明变更</h3>
          <p>开发者保留随时修改本声明的权利。修改后的声明自发布之日起生效，继续使用本软件即视为接受修改后的声明。</p>
        </section>
      </div>

      <div class="pt-4 border-t border-slate-100 dark:border-slate-700 flex items-center justify-between gap-4 flex-wrap">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input v-model="agreed" type="checkbox" class="w-4 h-4 rounded text-brand-600 focus:ring-brand-500" />
          <span class="text-sm text-slate-700 dark:text-slate-200">我已阅读并同意以上全部声明</span>
        </label>
        <button class="btn-primary" :disabled="!agreed" @click="accept">
          <Icon name="check" /> 确认同意
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

const toast = useToast()
const agreed = ref(false)

onMounted(() => {
  if (import.meta.client && localStorage.getItem('disclaimer_accepted') === 'true') {
    agreed.value = true
  }
})

function accept() {
  if (!agreed.value) {
    toast.error('请先勾选「我已阅读并同意」')
    return
  }
  if (import.meta.client) {
    localStorage.setItem('disclaimer_accepted', 'true')
  }
  toast.success('感谢确认，祝您使用愉快')
}
</script>
