<%-- A template for checking Java class and expression integration. --%>
@import demo.Person
@import java.util.List
@param Person person
@param Person.Address address
@param List<Person> people
<p>${person.greet("Hello")}</p>
<p>${person.greet(2)}</p>
<p>${person.name()} ${address.city()} ${Person.LABEL}</p>
@for(Person row : people)
  @template.shared.card(title = row.name(), content = @`
    @template.shared.inner(content = @`<b>${row.greet("Hi")}</b>`)
  `)
@endfor
