<%-- A card for checking named arguments and nested content. --%>
@import gg.jte.Content
@param String title
@param Content content
@param boolean compact = false
<section><h2>${title}</h2>${content}</section>
